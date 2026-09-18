/**
 * 메타로 발견한 소스를 훑어 부족함(Gap)을 만든다.
 * 「무엇을 고칠지」가 아니라 「무엇이 비었는지」만 센다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  discoverHealthSources,
  OPEN_STATUS,
  type HealthSource,
  type StudyGap
} from "@/lib/luna/study-health-meta";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function gapId(table: string, capability: string, key = ""): string {
  return `${table}:${capability}${key ? `:${key}` : ""}`;
}

async function scanOpenStatus(
  admin: SupabaseClient,
  source: HealthSource
): Promise<StudyGap | null> {
  if (!source.capabilities.includes("open_status")) return null;
  const { data, error } = await admin
    .from(source.table)
    .select("status")
    .limit(2000);
  if (error || !data) return null;
  const open = (data as Array<{ status?: string }>).filter((r) =>
    OPEN_STATUS.has(String(r.status ?? "").toLowerCase())
  );
  if (open.length === 0) return null;
  const byStatus = new Map<string, number>();
  for (const row of open) {
    const s = String(row.status ?? "unknown");
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const detail = [...byStatus.entries()]
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return {
    id: gapId(source.table, "open_status"),
    table: source.table,
    capability: "open_status",
    signal: `${source.table} 미처리 ${open.length}건 (${detail})`,
    count: open.length,
    sample: open.slice(0, 5) as Record<string, unknown>[],
    verifiable: source.table === "luna_questions" || source.table === "luna_learnings",
    method: "inspect_gap",
    impact: open.length,
    human_failure: false,
    stale_days: null,
    scope: { table: source.table, statuses: [...byStatus.keys()] }
  };
}

async function scanFailureCauses(
  admin: SupabaseClient
): Promise<StudyGap[]> {
  const { listLunaFailures, classifyFailureCause, isInspectFailure } = await import(
    "@/lib/luna/failures"
  );
  let rows: Awaited<ReturnType<typeof listLunaFailures>> = [];
  try {
    rows = await listLunaFailures(admin, { verdict: "open" });
  } catch {
    return [];
  }
  const open = rows.filter((r) => !isInspectFailure(r));
  if (open.length === 0) return [];
  const byCause = new Map<string, typeof open>();
  for (const row of open) {
    const cause =
      row.cause_type ??
      classifyFailureCause({
        question: row.question,
        answer_excerpt: row.answer_excerpt,
        signal: row.signal,
        signals: row.signals,
        intent_score: row.intent_score,
        confidence_score: row.confidence_score,
        sources_used: row.sources_used,
        duration_ms: row.duration_ms,
        types: row.types,
        source_ref: row.source_ref
      });
    const list = byCause.get(cause) ?? [];
    list.push(row);
    byCause.set(cause, list);
  }
  return [...byCause.entries()].map(([cause, causeRows]) => ({
    id: gapId("luna_failures", "failure_causes", cause),
    table: "luna_failures",
    capability: "failure_causes",
    signal: `실패 수집 「${cause}」 ${causeRows.length}건 미해결`,
    count: causeRows.length,
    sample: causeRows.slice(0, 5).map((r) => ({
      id: r.id,
      question: (r.question ?? "").slice(0, 80)
    })),
    verifiable: cause === "search_miss",
    method: cause === "search_miss" ? "probe_retrieval" : "inspect_gap",
    impact: causeRows.length * 3,
    human_failure: true,
    stale_days: null,
    scope: {
      mode: "failure_review",
      cause,
      failure_ids: causeRows.slice(0, 40).map((r) => r.id)
    }
  }));
}

async function scanTalkSearchQuality(
  admin: SupabaseClient
): Promise<StudyGap[]> {
  const since = daysAgoIso(30);
  const { data, error } = await admin
    .from("luna_messages")
    .select("id, meta, created_at")
    .eq("role", "assistant")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(800);
  if (error || !data) return [];
  let zero = 0;
  let requery = 0;
  for (const row of data as Array<{ meta?: unknown }>) {
    const meta =
      row.meta && typeof row.meta === "object"
        ? (row.meta as Record<string, unknown>)
        : {};
    const cards = Array.isArray(meta.cards) ? meta.cards : [];
    const rounds =
      typeof meta.search_rounds === "number" ? meta.search_rounds : 0;
    const searched =
      Boolean(meta.search) ||
      rounds > 0 ||
      Boolean(meta.sources) ||
      cards.length > 0;
    if (searched && cards.length === 0) zero += 1;
    if (rounds >= 2) requery += 1;
  }
  const gaps: StudyGap[] = [];
  if (zero > 0) {
    gaps.push({
      id: gapId("luna_messages", "talk_search_quality", "zero"),
      table: "luna_messages",
      capability: "talk_search_quality",
      signal: `최근 30일 검색 0건 응답 ${zero}회`,
      count: zero,
      sample: [],
      verifiable: true,
      method: "probe_retrieval",
      impact: zero * 2,
      human_failure: true,
      stale_days: null,
      scope: { mode: "answer_key", window_days: 30, metric: "search_zero", page_limit: 20 }
    });
  }
  if (requery > 0) {
    gaps.push({
      id: gapId("luna_messages", "talk_search_quality", "requery"),
      table: "luna_messages",
      capability: "talk_search_quality",
      signal: `최근 30일 재검색(2라운드+) ${requery}회`,
      count: requery,
      sample: [],
      verifiable: true,
      method: "probe_retrieval",
      impact: requery,
      human_failure: true,
      stale_days: null,
      scope: { mode: "answer_key", window_days: 30, metric: "requery", page_limit: 20 }
    });
  }
  return gaps;
}

async function scanPrimaryNotion(
  admin: SupabaseClient
): Promise<StudyGap[]> {
  const { count: total } = await admin
    .from("luna_notion_pages")
    .select("page_id", { count: "exact", head: true });
  const { count: nullProps } = await admin
    .from("luna_notion_pages")
    .select("page_id", { count: "exact", head: true })
    .is("properties", null);

  const gaps: StudyGap[] = [];
  // 14일 stale 은 대기열 조건에서 제외. properties null · 관계/스키마 변경만.
  if ((nullProps ?? 0) > 0) {
    gaps.push({
      id: gapId("luna_notion_pages", "primary_notion", "null_props"),
      table: "luna_notion_pages",
      capability: "primary_notion",
      signal: `노션 properties 비어 있는 페이지 ${nullProps}건 / 전체 ${total ?? 0}`,
      count: nullProps ?? 0,
      sample: [],
      verifiable: true,
      method: "refresh_stale",
      impact: Math.min(nullProps ?? 0, 200),
      human_failure: false,
      stale_days: null,
      scope: { null_properties: true, total: total ?? 0 }
    });
  }
  return gaps;
}

async function scanSecondaryCoverage(
  admin: SupabaseClient
): Promise<StudyGap[]> {
  const { count: sameNeed } = await admin
    .from("luna_links")
    .select("id", { count: "exact", head: true })
    .eq("kind", "same")
    .neq("source", "human")
    .neq("status", "rejected");
  const { count: sameAll } = await admin
    .from("luna_links")
    .select("id", { count: "exact", head: true })
    .eq("kind", "same");
  const gaps: StudyGap[] = [];
  if ((sameNeed ?? 0) > 0) {
    gaps.push({
      id: gapId("luna_links", "secondary_coverage", "same_need"),
      table: "luna_links",
      capability: "secondary_coverage",
      signal: `2차 「같은 것」확인 필요 ${sameNeed}건 (전체 ${sameAll ?? 0})`,
      count: sameNeed ?? 0,
      sample: [],
      verifiable: false,
      method: "inspect_gap",
      impact: sameNeed ?? 0,
      human_failure: false,
      stale_days: null,
      scope: { kind: "same", need_review: true }
    });
  }
  return gaps;
}

async function scanMediaGaps(admin: SupabaseClient): Promise<StudyGap | null> {
  const { count: emptyDesc } = await admin
    .from("luna_media_index")
    .select("path", { count: "exact", head: true })
    .or("description.is.null,description.eq.");
  if (!emptyDesc) return null;
  return {
    id: gapId("luna_media_index", "media_gaps"),
    table: "luna_media_index",
    capability: "media_gaps",
    signal: `이미지 설명 비어 있음 ${emptyDesc}건`,
    count: emptyDesc,
    sample: [],
    verifiable: true,
    method: "inspect_gap",
    impact: Math.min(emptyDesc, 100),
    human_failure: false,
    stale_days: null,
    scope: { empty_description: true }
  };
}

async function scanKnowledgeGaps(
  admin: SupabaseClient
): Promise<StudyGap | null> {
  const { count: pending } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: candidate } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate");
  const count = (pending ?? 0) + (candidate ?? 0);
  if (!count) return null;
  return {
    id: gapId("luna_learnings", "knowledge_gaps"),
    table: "luna_learnings",
    capability: "knowledge_gaps",
    signal: `지식후보 대기 ${count}건`,
    count,
    sample: [],
    verifiable: false,
    method: "inspect_gap",
    impact: count,
    human_failure: false,
    stale_days: null,
    scope: { status: ["pending", "candidate"] }
  };
}

export async function scanStudyGaps(
  admin: SupabaseClient
): Promise<{ sources: HealthSource[]; gaps: StudyGap[] }> {
  const sources = await discoverHealthSources(admin);
  const gaps: StudyGap[] = [];
  const caps = new Set(sources.flatMap((s) => s.capabilities));

  for (const source of sources) {
    if (source.capabilities.includes("open_status")) {
      const g = await scanOpenStatus(admin, source);
      if (g) gaps.push(g);
    }
  }
  if (caps.has("failure_causes")) {
    gaps.push(...(await scanFailureCauses(admin)));
  }
  if (caps.has("talk_search_quality")) {
    gaps.push(...(await scanTalkSearchQuality(admin)));
  }
  if (caps.has("primary_notion")) {
    gaps.push(...(await scanPrimaryNotion(admin)));
  }
  if (caps.has("secondary_coverage")) {
    gaps.push(...(await scanSecondaryCoverage(admin)));
  }
  if (caps.has("media_gaps")) {
    const g = await scanMediaGaps(admin);
    if (g) gaps.push(g);
  }
  if (caps.has("knowledge_gaps")) {
    const g = await scanKnowledgeGaps(admin);
    if (g) gaps.push(g);
  }

  gaps.sort((a, b) => {
    if (a.human_failure !== b.human_failure) return a.human_failure ? -1 : 1;
    return b.impact - a.impact;
  });

  return { sources, gaps };
}
