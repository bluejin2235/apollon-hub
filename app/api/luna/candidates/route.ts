import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isGlossaryCandidate } from "@/lib/luna/candidate-format";
import {
  normalizeThread,
  type CandidateSource,
  type ThreadTurn
} from "@/lib/luna/candidates";

export const runtime = "nodejs";

export type PendingFilter =
  | "all"
  | "chat"
  | "selfstudy"
  | "question"
  | "direct"
  | "glossary";

type LearningRow = {
  id: string;
  content: string;
  category: string;
  status: string;
  source: string | null;
  origin: string;
  evidence: string | null;
  scope_suggestion: string | null;
  thread: unknown;
  author_id: string | null;
  assigned_to: string | null;
  source_conversation_id: string | null;
  created_at: string | null;
  snoozed_until: string | null;
  meta: Record<string, unknown> | null;
};

export type CandidateItem = LearningRow & {
  author_name: string | null;
  assigned_name: string | null;
  thread: ThreadTurn[];
  source: CandidateSource;
  is_glossary: boolean;
  is_my_turn: boolean;
};

export type CandidateCounts = {
  all: number;
  chat: number;
  selfstudy: number;
  question: number;
  direct: number;
  glossary: number;
};

function resolveSource(row: LearningRow): CandidateSource {
  const s = row.source;
  if (s === "chat" || s === "selfstudy" || s === "question" || s === "direct") {
    return s;
  }
  return row.origin === "direct" ? "direct" : "chat";
}

function isSnoozed(row: LearningRow): boolean {
  if (!row.snoozed_until) return false;
  const until = new Date(String(row.snoozed_until)).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const filter: PendingFilter =
    filterRaw === "chat" ||
    filterRaw === "selfstudy" ||
    filterRaw === "question" ||
    filterRaw === "direct" ||
    filterRaw === "glossary"
      ? filterRaw
      : "all";

  const { data, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, category, status, source, origin, evidence, scope_suggestion, thread, author_id, assigned_to, source_conversation_id, created_at, snoozed_until, meta"
    )
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/candidates] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allRows = (data ?? []) as LearningRow[];
  const rows = allRows.filter((r) => !isSnoozed(r));

  const counts: CandidateCounts = {
    all: rows.length,
    chat: 0,
    selfstudy: 0,
    question: 0,
    direct: 0,
    glossary: 0
  };
  for (const r of rows) {
    const src = resolveSource(r);
    if (src === "chat") counts.chat += 1;
    if (src === "selfstudy") counts.selfstudy += 1;
    if (src === "question") counts.question += 1;
    if (src === "direct") counts.direct += 1;
    if (isGlossaryCandidate(r.meta, r.category)) counts.glossary += 1;
  }

  let filtered = rows;
  if (filter === "chat" || filter === "selfstudy" || filter === "question" || filter === "direct") {
    filtered = rows.filter((r) => resolveSource(r) === filter);
  } else if (filter === "glossary") {
    filtered = rows.filter((r) => isGlossaryCandidate(r.meta, r.category));
  }

  const nameIds = Array.from(
    new Set(
      filtered
        .flatMap((r) => [r.author_id, r.assigned_to])
        .filter((id): id is string => Boolean(id))
    )
  );
  const nameMap = new Map<string, string>();
  if (nameIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", nameIds);
    for (const p of profiles ?? []) {
      nameMap.set(
        p.id as string,
        ((p.name as string) || "").trim() || "이름 없음"
      );
    }
  }

  const items: CandidateItem[] = filtered.map((r) => {
    const source = resolveSource(r);
    const thread = normalizeThread(r.thread);
    const isMyTurn =
      source === "question" &&
      r.assigned_to === user.id &&
      thread.length > 0 &&
      thread[thread.length - 1]?.role === "luna";
    return {
      ...r,
      source,
      thread,
      is_glossary: isGlossaryCandidate(r.meta, r.category),
      is_my_turn: isMyTurn,
      author_name: r.author_id ? nameMap.get(r.author_id) ?? null : null,
      assigned_name: r.assigned_to ? nameMap.get(r.assigned_to) ?? null : null
    };
  });

  const myTurnCount = rows.filter(
    (r) =>
      resolveSource(r) === "question" &&
      r.assigned_to === user.id &&
      !isSnoozed(r)
  ).length;

  return NextResponse.json({
    items,
    count: items.length,
    counts,
    my_turn_count: myTurnCount,
    current_user_id: user.id
  });
}
