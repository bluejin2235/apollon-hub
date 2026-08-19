import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import {
  getSelfstudySettings,
  nextSelfstudyRunLabel
} from "@/lib/luna/selfstudy";

export const runtime = "nodejs";

export type SelfstudyStatusKind =
  | "pending"
  | "confirmed"
  | "not_needed"
  | "rejected";

export type SelfstudyHistoryFilter = "all" | "confirmed" | "pending" | "dropped";

type Row = {
  id: string;
  content: string;
  status: string;
  evidence: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

function metaOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function statusKind(row: Row): SelfstudyStatusKind {
  if (row.status === "candidate") return "pending";
  if (row.status === "active") return "confirmed";
  return metaOf(row.meta).not_needed === true ? "not_needed" : "rejected";
}

/** KST 기준 날짜키 + 라벨 */
function kstDayParts(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: "unknown", label: "날짜 미상" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: "unknown", label: "날짜 미상" };
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  return {
    key: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    label: `${m}월 ${day}일`
  };
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(
    kst.getUTCDate()
  ).padStart(2, "0")}`;
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
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const filter: SelfstudyHistoryFilter =
    filterRaw === "confirmed" || filterRaw === "pending" || filterRaw === "dropped"
      ? filterRaw
      : "all";

  const { data, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, evidence, meta, created_at, resolved_at, resolved_by"
    )
    .eq("source", "selfstudy")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[luna/selfstudy/history] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  const stats = {
    total: rows.length,
    confirmed: 0,
    pending: 0,
    dropped: 0,
    accuracy_pct: null as number | null
  };
  for (const r of rows) {
    const kind = statusKind(r);
    if (kind === "confirmed") stats.confirmed += 1;
    else if (kind === "pending") stats.pending += 1;
    else stats.dropped += 1;
  }
  if (stats.total > 0) {
    stats.accuracy_pct = Math.round((stats.confirmed / stats.total) * 100);
  }

  // 자습 주제 이름 보강 — 테이블이 없으면 조용히 건너뛴다
  const queueTopics = new Map<string, string>();
  try {
    const { data: queue, error: queueError } = await admin
      .from("luna_selfstudy_queue")
      .select("id, topic")
      .order("created_at", { ascending: false })
      .limit(300);
    if (!queueError) {
      for (const q of queue ?? []) {
        if (typeof q.id === "string" && typeof q.topic === "string") {
          queueTopics.set(q.id, q.topic);
        }
      }
    }
  } catch {
    /* luna_selfstudy_queue 없음 — luna_learnings 만으로 구성 */
  }

  const resolverIds = Array.from(
    new Set(
      rows
        .map((r) => r.resolved_by)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );
  const nameMap = new Map<string, string>();
  if (resolverIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", resolverIds);
    for (const p of profiles ?? []) {
      nameMap.set(p.id as string, ((p.name as string) || "").trim() || "이름 없음");
    }
  }

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    const kind = statusKind(r);
    if (filter === "confirmed") return kind === "confirmed";
    if (filter === "pending") return kind === "pending";
    return kind === "rejected" || kind === "not_needed";
  });

  const groups: Array<{
    key: string;
    label: string;
    items: Array<{
      id: string;
      status_kind: SelfstudyStatusKind;
      source_note: string;
      question: string | null;
      answer: string;
      found: string | null;
    }>;
  }> = [];
  const groupIndex = new Map<string, number>();

  for (const r of filtered) {
    const meta = metaOf(r.meta);
    const { key, label } = kstDayParts(r.created_at);
    if (!groupIndex.has(key)) {
      groupIndex.set(key, groups.length);
      groups.push({ key, label, items: [] });
    }
    const kind = statusKind(r);

    const topic =
      (typeof meta.topic === "string" && meta.topic.trim()) ||
      (typeof meta.queue_id === "string" ? queueTopics.get(meta.queue_id) : null) ||
      null;
    const evidence =
      typeof r.evidence === "string" ? r.evidence.replace(/^출처:\s*/, "").trim() : "";
    const sourceNote = evidence
      ? `출처: ${evidence}`
      : topic
        ? `출처: ${topic}`
        : "출처: —";

    // "찾은 곳"에 해당하는 검색 근거는 저장하지 않으므로,
    // 확정된 건에 한해 처리자·일시를 대신 노출한다.
    let found: string | null = null;
    if (kind === "confirmed") {
      const who = r.resolved_by ? nameMap.get(r.resolved_by) ?? null : null;
      const when = shortDate(r.resolved_at);
      if (who || when) {
        found = `${who ?? "—"} 확정${when ? ` ${when}` : ""}`;
      }
    }

    groups[groupIndex.get(key)!]!.items.push({
      id: r.id,
      status_kind: kind,
      source_note: sourceNote,
      question:
        typeof meta.question === "string" && meta.question.trim()
          ? meta.question.trim()
          : topic,
      answer: typeof r.content === "string" ? r.content : "",
      found
    });
  }

  const settings = await getSelfstudySettings(admin);

  return NextResponse.json({
    stats,
    filter_counts: {
      all: stats.total,
      confirmed: stats.confirmed,
      pending: stats.pending,
      dropped: stats.dropped
    },
    next_run_label: nextSelfstudyRunLabel(settings.run_hour, settings.run_minute),
    groups
  });
}
