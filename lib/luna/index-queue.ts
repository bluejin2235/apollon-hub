/**
 * 1차 색인 강제 갱신 대기열.
 * 자동 enqueue 조건: properties null · 관계 변경 · 스키마 변경 · 색인 실패 · 수동.
 * 「14일 이상 안 갱신」은 넣지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const INDEX_QUEUE_DRAIN_MAX = 200;

export type IndexQueueSource = "notion" | "nas" | "image";
/** stale 은 옛 행용. 새로 넣지 않는다. */
export type IndexQueueReason =
  | "stale"
  | "properties_null"
  | "relation_changed"
  | "schema_changed"
  | "index_failed"
  | "manual";
export type IndexQueueStatus = "pending" | "running" | "done" | "failed";
export type IndexQueueQueuedBy = "selfstudy" | "manual" | "cron";

export type IndexQueueRow = {
  id: string;
  source: IndexQueueSource;
  target_id: string;
  reason: IndexQueueReason;
  priority: number;
  status: IndexQueueStatus;
  queued_by: IndexQueueQueuedBy;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export type IndexQueueCounts = {
  pending: number;
  running: number;
  done: number;
  failed: number;
};

export type EnqueueNotionResult = {
  inserted: number;
  skipped: number;
  /** @deprecated always 0 — stale 자동 enqueue 폐지 */
  staleFound: number;
  nullPropsFound: number;
  sample: Array<{ page_id: string; title: string; reason: IndexQueueReason }>;
};

export type QueuePageFacts = {
  relations: number;
  propertiesFilled: number;
  pages: number;
};

export type IndexQueueDrainStats = {
  claimed: number;
  processed: number;
  failed: number;
  remaining: number;
  duration_ms: number;
  relations_before: number;
  relations_after: number;
  properties_filled_before: number;
  properties_filled_after: number;
  sample_errors: string[];
};

const PRIORITY: Record<IndexQueueReason, number> = {
  index_failed: 90,
  properties_null: 80,
  schema_changed: 75,
  relation_changed: 70,
  manual: 60,
  stale: 10
};

const PAGE = 1000;
const INSERT_BATCH = 100;

function isMissingTableError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist/i.test(msg) ||
    /Could not find the table/i.test(msg)
  );
}

async function countExact(
  admin: SupabaseClient,
  status: IndexQueueStatus
): Promise<number> {
  const { count, error } = await admin
    .from("luna_index_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) {
    if (isMissingTableError(error)) return 0;
    throw new Error(`luna_index_queue count: ${error.message}`);
  }
  return count ?? 0;
}

export async function countIndexQueue(
  admin: SupabaseClient
): Promise<IndexQueueCounts> {
  const [pending, running, done, failed] = await Promise.all([
    countExact(admin, "pending"),
    countExact(admin, "running"),
    countExact(admin, "done"),
    countExact(admin, "failed")
  ]);
  return { pending, running, done, failed };
}

async function listActiveNotionTargets(
  admin: SupabaseClient
): Promise<Set<string>> {
  const out = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("luna_index_queue")
      .select("target_id")
      .eq("source", "notion")
      .in("status", ["pending", "running"])
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTableError(error)) return out;
      throw new Error(`luna_index_queue active: ${error.message}`);
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (typeof row.target_id === "string") out.add(row.target_id);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function listNotionPages(
  admin: SupabaseClient,
  filter: { propertiesNull?: boolean }
): Promise<Array<{ page_id: string; title: string }>> {
  const out: Array<{ page_id: string; title: string }> = [];
  let from = 0;
  while (true) {
    let q = admin.from("luna_notion_pages").select("page_id, title").order("page_id");
    if (filter.propertiesNull) {
      q = q.is("properties", null);
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`luna_notion_pages list: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      out.push({
        page_id: String(row.page_id ?? ""),
        title: typeof row.title === "string" ? row.title : ""
      });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out.filter((r) => r.page_id);
}

async function insertQueueRows(
  admin: SupabaseClient,
  rows: Array<{
    source: IndexQueueSource;
    target_id: string;
    reason: IndexQueueReason;
    priority: number;
    queued_by: IndexQueueQueuedBy;
  }>
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const part = rows.slice(i, i + INSERT_BATCH);
    const { data, error } = await admin
      .from("luna_index_queue")
      .insert(part)
      .select("id");
    if (error) {
      if (error.code === "23505") {
        for (const row of part) {
          const { data: one, error: oneErr } = await admin
            .from("luna_index_queue")
            .insert(row)
            .select("id");
          if (oneErr) {
            if (oneErr.code === "23505") continue;
            throw new Error(`luna_index_queue insert: ${oneErr.message}`);
          }
          inserted += one?.length ?? 0;
        }
        continue;
      }
      throw new Error(`luna_index_queue insert: ${error.message}`);
    }
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function enqueueNotionRefresh(opts: {
  admin: SupabaseClient;
  queuedBy: IndexQueueQueuedBy;
}): Promise<EnqueueNotionResult> {
  const admin = opts.admin;
  const active = await listActiveNotionTargets(admin);

  const nullPages = await listNotionPages(admin, { propertiesNull: true });

  const toInsert: Array<{
    source: IndexQueueSource;
    target_id: string;
    reason: IndexQueueReason;
    priority: number;
    queued_by: IndexQueueQueuedBy;
  }> = [];
  const sample: EnqueueNotionResult["sample"] = [];

  const add = (page_id: string, title: string, reason: IndexQueueReason) => {
    if (active.has(page_id)) return;
    active.add(page_id);
    toInsert.push({
      source: "notion",
      target_id: page_id,
      reason,
      priority: PRIORITY[reason],
      queued_by: opts.queuedBy
    });
    if (sample.length < 12) {
      sample.push({ page_id, title, reason });
    }
  };

  for (const p of nullPages) add(p.page_id, p.title, "properties_null");

  const inserted = await insertQueueRows(admin, toInsert);
  return {
    inserted,
    skipped: nullPages.length - toInsert.length,
    staleFound: 0,
    nullPropsFound: nullPages.length,
    sample
  };
}

export async function claimIndexQueue(
  admin: SupabaseClient,
  limit: number
): Promise<IndexQueueRow[]> {
  if (limit <= 0) return [];
  const { data: pending, error } = await admin
    .from("luna_index_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`luna_index_queue claim list: ${error.message}`);
  }
  const ids = (pending ?? []).map((r) => r.id as string);
  if (ids.length === 0) return [];
  const started = new Date().toISOString();
  const { data, error: updErr } = await admin
    .from("luna_index_queue")
    .update({ status: "running", started_at: started, error: null })
    .in("id", ids)
    .eq("status", "pending")
    .select("*");
  if (updErr) throw new Error(`luna_index_queue claim: ${updErr.message}`);
  return (data ?? []) as IndexQueueRow[];
}

export async function finishIndexQueueItem(
  admin: SupabaseClient,
  id: string,
  patch: { status: "done" | "failed" | "pending"; error?: string | null }
): Promise<void> {
  const { error } = await admin
    .from("luna_index_queue")
    .update({
      status: patch.status,
      finished_at: patch.status === "pending" ? null : new Date().toISOString(),
      started_at: patch.status === "pending" ? null : undefined,
      error: patch.error ?? null
    })
    .eq("id", id);
  if (error) throw new Error(`luna_index_queue finish: ${error.message}`);
}

export async function measureNotionPageFacts(
  admin: SupabaseClient,
  pageIds: string[]
): Promise<QueuePageFacts> {
  if (pageIds.length === 0) {
    return { relations: 0, propertiesFilled: 0, pages: 0 };
  }
  let relations = 0;
  let propertiesFilled = 0;
  for (let i = 0; i < pageIds.length; i += 100) {
    const part = pageIds.slice(i, i + 100);
    const { count: rel, error: relErr } = await admin
      .from("luna_notion_relations")
      .select("from_page_id", { count: "exact", head: true })
      .in("from_page_id", part);
    if (relErr) throw new Error(`relations count: ${relErr.message}`);
    relations += rel ?? 0;
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, properties")
      .in("page_id", part);
    if (error) throw new Error(`properties count: ${error.message}`);
    for (const row of data ?? []) {
      if (row.properties != null) propertiesFilled += 1;
    }
  }
  return { relations, propertiesFilled, pages: pageIds.length };
}

export function formatQueueDrainResult(
  stats: IndexQueueDrainStats,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const relDelta = stats.relations_after - stats.relations_before;
  const propDelta = stats.properties_filled_after - stats.properties_filled_before;
  const relLabel = relDelta === 0 ? "관계 변화 없음" : `관계 ${relDelta > 0 ? "+" : ""}${relDelta}`;
  const propLabel =
    propDelta === 0
      ? "properties 변화 없음"
      : `properties 채워짐 ${propDelta > 0 ? "+" : ""}${propDelta}`;
  return {
    processed: stats.processed,
    failed: stats.failed,
    remaining: stats.remaining,
    duration_ms: stats.duration_ms,
    relations_before: stats.relations_before,
    relations_after: stats.relations_after,
    relations_delta: relDelta,
    properties_filled_before: stats.properties_filled_before,
    properties_filled_after: stats.properties_filled_after,
    properties_delta: propDelta,
    did: `대기열에서 ${stats.processed}건을 강제 재색인했습니다`,
    result_line: `${stats.processed}건 갱신 · ${relLabel} · ${propLabel} · 남음 ${stats.remaining}`,
    learned:
      "last_edited_time 이 그대로여도 대기열 페이지는 노션에서 다시 읽습니다",
    next:
      stats.remaining > 0
        ? "다음 색인 실행이 대기열부터 최대 200건 이어서 처리합니다"
        : "대기열이 비었습니다. 다음엔 평소 증분 색인입니다",
    sample_errors: stats.sample_errors,
    ...extra
  };
}

export async function recordIndexQueueStudyResult(
  admin: SupabaseClient,
  stats: IndexQueueDrainStats,
  extra?: Record<string, unknown>
): Promise<void> {
  const result = formatQueueDrainResult(stats, extra);
  const outcome =
    stats.failed > 0 && stats.processed === 0
      ? "failed"
      : stats.processed > 0
        ? "improved"
        : "no_change";
  const { error } = await admin.from("luna_study_runs").insert({
    agenda: "오래된 1차 색인 대기열 갱신",
    why: "14일 이상 안 갱신됐거나 properties 가 비어 있으면 last_edited_time 이 그대로여도 다시 읽어야 합니다",
    expected: "한 실행에 최대 200건 강제 재색인 · 관계·properties 변화 기록",
    kind: "refresh_stale",
    scope: { source: "luna_index_queue", drain_max: INDEX_QUEUE_DRAIN_MAX },
    started_at: new Date(Date.now() - stats.duration_ms).toISOString(),
    finished_at: new Date().toISOString(),
    result,
    outcome,
    cost_usd: 0,
    llm_calls: 0
  });
  if (error) {
    console.error("[index-queue] study_runs insert", error.message);
  }
}

export async function loadLastQueueStudyResult(
  admin: SupabaseClient
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("result, outcome, finished_at")
    .eq("kind", "refresh_stale")
    .order("started_at", { ascending: false })
    .limit(8);
  if (error || !data) return null;
  for (const row of data) {
    const result = (row.result ?? {}) as Record<string, unknown>;
    if (typeof result.processed === "number") {
      return {
        ...result,
        outcome: row.outcome,
        finished_at: row.finished_at
      };
    }
  }
  return null;
}
