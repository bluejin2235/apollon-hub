import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  analyzeAssistantMessage,
  asMessageMeta,
  avText,
  buildConversationSummary,
  emptySignals,
  formatRelativeWhen,
  kstDateRange,
  mergeSignals,
  parseIsoRange,
  TALK_LINE_COLORS,
  weekBucketsInRange
} from "@/lib/luna/talk-metrics";

export const runtime = "nodejs";

const PAGE_SIZE = 20;

type ReactionFilter =
  | "all"
  | "good"
  | "bad"
  | "correction"
  | "unapplied"
  | "search_zero";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

function isCorrectionLearning(row: {
  meta: unknown;
  thread: unknown;
  source: string | null;
}): boolean {
  const meta =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  if (meta.from_correction === true) return true;
  const thread = Array.isArray(row.thread) ? row.thread : [];
  return thread.some(
    (t) => t && typeof t === "object" && (t as { role?: string }).role === "human"
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const url = request.nextUrl;
  const daysRaw = url.searchParams.get("days");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const userFilter = url.searchParams.get("user_id");
  const reaction = (url.searchParams.get("reaction") ?? "all") as ReactionFilter;
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  let range =
    from && to ? parseIsoRange(from, to) : null;
  if (!range) {
    const days = daysRaw === "7" || daysRaw === "90" ? Number(daysRaw) : 30;
    range = kstDateRange(days);
  }

  const { data: convRows, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id, title, updated_at, created_at")
    .gte("updated_at", range.startIso)
    .lte("updated_at", range.endIso)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }

  const conversations = convRows ?? [];
  const convIds = conversations.map((c) => c.id as string);
  const userIds = Array.from(
    new Set(conversations.map((c) => c.user_id as string).filter(Boolean))
  );

  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      nameById.set(
        p.id as string,
        ((p.name as string) || "").trim() || "—"
      );
    }
  }

  const { data: allProfiles } = await admin.from("profiles").select("id, name");
  const allUsers = (allProfiles ?? []).map((p) => ({
    id: p.id as string,
    name: ((p.name as string) || "").trim() || "—"
  }));

  let messagesByConv = new Map<
    string,
    Array<{ role: string; content: string; metadata: unknown; created_at: string }>
  >();
  if (convIds.length > 0) {
    const { data: messages } = await admin
      .from("luna_messages")
      .select("conversation_id, role, content, metadata, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true });
    for (const m of messages ?? []) {
      const cid = m.conversation_id as string;
      const list = messagesByConv.get(cid) ?? [];
      list.push({
        role: m.role as string,
        content: (m.content as string) || "",
        metadata: m.metadata,
        created_at: m.created_at as string
      });
      messagesByConv.set(cid, list);
    }
  }

  const learningsByConv = new Map<
    string,
    Array<{
      id: string;
      content: string;
      status: string;
      meta: unknown;
      thread: unknown;
      source: string | null;
    }>
  >();
  if (convIds.length > 0) {
    const { data: learnings } = await admin
      .from("luna_learnings")
      .select("id, content, status, meta, thread, source, source_conversation_id")
      .in("source_conversation_id", convIds)
      .neq("category", "identity");
    for (const l of learnings ?? []) {
      const cid = l.source_conversation_id as string;
      const list = learningsByConv.get(cid) ?? [];
      list.push({
        id: l.id as string,
        content: l.content as string,
        status: l.status as string,
        meta: l.meta,
        thread: l.thread,
        source: (l.source as string) ?? null
      });
      learningsByConv.set(cid, list);
    }
  }

  type ConvAgg = {
    id: string;
    user_id: string;
    user_name: string;
    updated_at: string;
    message_count: number;
    signals: ReturnType<typeof emptySignals>;
    summary: string;
    corrections: Array<{ text: string; status: "active" | "candidate" | "other" }>;
    candidate_count: number;
    has_unapplied: boolean;
    search_text: string;
  };

  const aggs: ConvAgg[] = [];
  let filterCounts = { good: 0, bad: 0, correction: 0, unapplied: 0, search_zero: 0 };

  for (const c of conversations) {
    const id = c.id as string;
    const msgs = messagesByConv.get(id) ?? [];
    const learnings = learningsByConv.get(id) ?? [];
    let signals = emptySignals();
    for (const m of msgs) {
      if (m.role !== "assistant") continue;
      signals = mergeSignals(
        signals,
        analyzeAssistantMessage(m.content, asMessageMeta(m.metadata))
      );
    }

    const corrections = learnings
      .filter((l) => isCorrectionLearning(l))
      .map((l) => ({
        text: l.content,
        status:
          l.status === "active"
            ? ("active" as const)
            : l.status === "candidate"
              ? ("candidate" as const)
              : ("other" as const)
      }));
    const candidate_count = learnings.filter((l) => l.status === "candidate").length;
    const has_unapplied =
      signals.thumbsDown > 0 &&
      !learnings.some(
        (l) =>
          l.status === "candidate" &&
          (isCorrectionLearning(l) || l.source === "chat")
      );

    if (signals.thumbsUp > 0) filterCounts.good += 1;
    if (signals.thumbsDown > 0) filterCounts.bad += 1;
    if (corrections.length > 0) filterCounts.correction += 1;
    if (has_unapplied) filterCounts.unapplied += 1;
    if (signals.searchZero > 0) filterCounts.search_zero += 1;

    const search_text = [
      c.title,
      ...msgs.map((m) => m.content),
      ...learnings.map((l) => l.content)
    ]
      .join(" ")
      .toLowerCase();

    aggs.push({
      id,
      user_id: c.user_id as string,
      user_name: nameById.get(c.user_id as string) ?? "—",
      updated_at: c.updated_at as string,
      message_count: msgs.length,
      signals,
      summary: buildConversationSummary(msgs),
      corrections,
      candidate_count,
      has_unapplied,
      search_text
    });
  }

  let filtered = aggs;
  if (userFilter) {
    filtered = filtered.filter((a) => a.user_id === userFilter);
  }
  if (q) {
    filtered = filtered.filter((a) => a.search_text.includes(q));
  }
  if (reaction === "good") {
    filtered = filtered.filter((a) => a.signals.thumbsUp > 0);
  } else if (reaction === "bad") {
    filtered = filtered.filter((a) => a.signals.thumbsDown > 0);
  } else if (reaction === "correction") {
    filtered = filtered.filter((a) => a.corrections.length > 0);
  } else if (reaction === "unapplied") {
    filtered = filtered.filter((a) => a.has_unapplied);
  } else if (reaction === "search_zero") {
    filtered = filtered.filter((a) => a.signals.searchZero > 0);
  }

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const userCounts = new Map<string, number>();
  for (const a of aggs) {
    userCounts.set(a.user_id, (userCounts.get(a.user_id) ?? 0) + 1);
  }
  const ranked = [...userCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([user_id, count], i) => ({
      rank: i + 1,
      user_id,
      name: nameById.get(user_id) ?? "—",
      count,
      av: avText(nameById.get(user_id) ?? "?")
    }));

  const activeUserIds = new Set(userCounts.keys());
  const unusedCount = allUsers.filter((u) => !activeUserIds.has(u.id)).length;

  const weeks = weekBucketsInRange(range.startIso, range.endIso);
  const topUserIds = ranked.slice(0, 3).map((r) => r.user_id);
  const trendSeries = weeks.map((w) => {
    const slice = aggs.filter(
      (a) => a.updated_at >= w.startIso && a.updated_at < w.endIso
    );
    const values: Record<string, number> = {};
    for (const uid of topUserIds) values[uid] = 0;
    let others = 0;
    for (const a of slice) {
      if (topUserIds.includes(a.user_id)) {
        values[a.user_id] = (values[a.user_id] ?? 0) + 1;
      } else {
        others += 1;
      }
    }
    values.__others__ = others;
    return { label: w.label, values };
  });

  const trendUsers = [
    ...ranked.slice(0, 3).map((r, i) => ({
      key: r.user_id,
      name: r.name,
      color: TALK_LINE_COLORS[i] ?? TALK_LINE_COLORS[3]
    })),
    ...(ranked.length > 3 || unusedCount > 0
      ? [
          {
            key: "__others__",
            name: `기타 ${Math.max(0, ranked.length - 3) + unusedCount}명`,
            color: TALK_LINE_COLORS[3]
          }
        ]
      : [])
  ];

  return NextResponse.json({
    range: {
      start: range.startLabel,
      end: range.endLabel,
      start_iso: range.startIso,
      end_iso: range.endIso
    },
    trend: { weeks: trendSeries, users: trendUsers },
    ranking: [
      ...ranked.slice(0, 5),
      ...(unusedCount > 0
        ? [{ rank: 0, user_id: "", name: `미사용 ${unusedCount}명`, count: 0, av: "", unused: true }]
        : [])
    ],
    filter_counts: filterCounts,
    users: allUsers,
    items: pageItems.map((a) => ({
      id: a.id,
      user_id: a.user_id,
      user_name: a.user_name,
      av: avText(a.user_name),
      when: formatRelativeWhen(a.updated_at),
      message_count: a.message_count,
      summary: a.summary,
      corrections: a.corrections,
      candidate_count: a.candidate_count,
      thumbs_up: a.signals.thumbsUp,
      thumbs_down: a.signals.thumbsDown,
      has_unapplied: a.has_unapplied,
      search_zero: a.signals.searchZero > 0,
      can_teach:
        a.signals.thumbsDown > 0 &&
        a.candidate_count === 0 &&
        a.corrections.length === 0
    })),
    page,
    page_size: PAGE_SIZE,
    total
  });
}
