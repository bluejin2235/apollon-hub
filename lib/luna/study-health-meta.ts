/**
 * 자습 건강 점검 — 무엇을 볼지는 테이블·컬럼 메타로 정한다.
 * 구체 작업명(고유명사 색인 등)을 박아 넣지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type StudyMethod =
  | "probe_retrieval"
  | "inspect_gap"
  | "materialize_secondary"
  | "refresh_stale";

export type ColumnInfo = {
  table: string;
  column: string;
  data_type: string;
};

export type HealthSource = {
  table: string;
  columns: string[];
  /** 컨벤션으로 붙인 점검 능력 */
  capabilities: string[];
};

export type StudyGap = {
  id: string;
  table: string;
  capability: string;
  signal: string;
  count: number;
  sample: Record<string, unknown>[];
  verifiable: boolean;
  method: StudyMethod;
  impact: number;
  human_failure: boolean;
  stale_days: number | null;
  scope: Record<string, unknown>;
};

const SKIP_TABLES = new Set([
  "luna_settings",
  "luna_prompts",
  "luna_prompt_versions",
  "luna_prompt_groups",
  "luna_model_market",
  "luna_model_modes",
  "luna_model_changes",
  "luna_engine_tiers",
  "luna_beta_access",
  "luna_attachments",
  "luna_department_lens",
  "luna_learning_settings",
  "luna_learning_versions",
  "luna_study_runs"
]);

export const OPEN_STATUS = new Set([
  "pending",
  "open",
  "unresolved",
  "queued",
  "running",
  "need_review",
  "active_draft"
]);

const CONTENT_NAME_HINT =
  /(pages|chunks|blocks|media|wiki|learnings|links|failures|signals|questions|messages|conversations|projects|library|rules|queue|reports|eval|perspectives)/i;

export function hasCol(cols: Set<string>, name: string): boolean {
  return cols.has(name);
}

export function anyCol(cols: Set<string>, names: string[]): string | null {
  for (const n of names) if (cols.has(n)) return n;
  return null;
}

function capabilitiesFor(table: string, columns: string[]): string[] {
  const set = new Set(columns);
  const capabilities: string[] = [];
  if (hasCol(set, "status") && CONTENT_NAME_HINT.test(table)) {
    capabilities.push("open_status");
  }
  const timeCol = anyCol(set, [
    "indexed_at",
    "last_edited_time",
    "updated_at",
    "created_at"
  ]);
  if (timeCol && CONTENT_NAME_HINT.test(table)) {
    capabilities.push("staleness");
  }
  if (table === "luna_failures") capabilities.push("failure_causes");
  if (table === "luna_signals") capabilities.push("signal_sources");
  if (table === "luna_links") capabilities.push("secondary_coverage");
  if (table === "luna_messages") capabilities.push("talk_search_quality");
  if (table === "luna_notion_pages") capabilities.push("primary_notion");
  if (table === "luna_questions") capabilities.push("pending_questions");
  if (table === "luna_learnings") capabilities.push("knowledge_gaps");
  if (table === "luna_media_index") capabilities.push("media_gaps");
  return [...new Set(capabilities)];
}

/** information_schema 에서 luna_* 테이블·컬럼을 읽고 능력(capability)을 붙인다. */
export async function discoverHealthSources(
  admin: SupabaseClient
): Promise<HealthSource[]> {
  const cols = await listPublicLunaColumns(admin);
  const byTable = new Map<string, string[]>();
  for (const row of cols) {
    if (!row.table.startsWith("luna_")) continue;
    if (SKIP_TABLES.has(row.table)) continue;
    const list = byTable.get(row.table) ?? [];
    list.push(row.column);
    byTable.set(row.table, list);
  }

  const sources: HealthSource[] = [];
  for (const [table, columns] of byTable) {
    const capabilities = capabilitiesFor(table, columns);
    if (capabilities.length) {
      sources.push({ table, columns, capabilities });
    }
  }
  return sources.sort((a, b) => a.table.localeCompare(b.table));
}

async function listPublicLunaColumns(
  admin: SupabaseClient
): Promise<ColumnInfo[]> {
  const { data, error } = await admin.rpc("luna_list_public_columns");
  if (!error && Array.isArray(data) && data.length > 0) {
    return (data as Array<Record<string, unknown>>).map((r) => ({
      table: String(r.table_name ?? r.table ?? ""),
      column: String(r.column_name ?? r.column ?? ""),
      data_type: String(r.data_type ?? "")
    }));
  }
  return FALLBACK_COLUMNS;
}

/** RPC 없을 때 쓰는 최소 컬럼 맵 — 새 테이블은 RPC 적용 후 자동 편입 */
const FALLBACK_COLUMNS: ColumnInfo[] = [
  { table: "luna_failures", column: "status", data_type: "text" },
  { table: "luna_failures", column: "cause_type", data_type: "text" },
  { table: "luna_failures", column: "created_at", data_type: "timestamptz" },
  { table: "luna_signals", column: "source", data_type: "text" },
  { table: "luna_signals", column: "kind", data_type: "text" },
  { table: "luna_signals", column: "created_at", data_type: "timestamptz" },
  { table: "luna_links", column: "kind", data_type: "text" },
  { table: "luna_links", column: "status", data_type: "text" },
  { table: "luna_links", column: "source", data_type: "text" },
  { table: "luna_links", column: "created_at", data_type: "timestamptz" },
  { table: "luna_notion_pages", column: "page_id", data_type: "text" },
  { table: "luna_notion_pages", column: "title", data_type: "text" },
  { table: "luna_notion_pages", column: "indexed_at", data_type: "timestamptz" },
  { table: "luna_notion_pages", column: "last_edited_time", data_type: "timestamptz" },
  { table: "luna_notion_pages", column: "properties", data_type: "jsonb" },
  { table: "luna_messages", column: "role", data_type: "text" },
  { table: "luna_messages", column: "meta", data_type: "jsonb" },
  { table: "luna_messages", column: "created_at", data_type: "timestamptz" },
  { table: "luna_questions", column: "status", data_type: "text" },
  { table: "luna_questions", column: "created_at", data_type: "timestamptz" },
  { table: "luna_learnings", column: "status", data_type: "text" },
  { table: "luna_learnings", column: "created_at", data_type: "timestamptz" },
  { table: "luna_media_index", column: "path", data_type: "text" },
  { table: "luna_media_index", column: "description", data_type: "text" },
  { table: "luna_media_index", column: "updated_at", data_type: "timestamptz" },
  { table: "luna_rules", column: "status", data_type: "text" },
  { table: "luna_perspectives", column: "status", data_type: "text" }
];
