import { isHarnessChatTitle } from "@/lib/luna/persona-test-marker";

/** Shared by production retrieval, memory and learning. Never infer tests from ordinary prose. */
export type LunaDataContext = "production" | "synthetic";

export function isSyntheticMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  return meta.data_context === "synthetic" || meta.is_test === true ||
    (typeof meta.test_run_id === "string" && meta.test_run_id.trim().length > 0);
}

export function isProductionData(row: {
  data_context?: unknown;
  title?: unknown;
  meta?: unknown;
} | null | undefined): boolean {
  if (!row) return false;
  // Missing context is allowed only for legacy in-memory objects. DB readers explicitly filter it.
  if (row.data_context != null && row.data_context !== "production") return false;
  return !isHarnessChatTitle(row.title) && !isSyntheticMetadata(row.meta);
}

/** Known legacy harness marker; suppress the entire contaminated memo until rebuilt. */
export function safeProductionMemo(value: unknown): string {
  if (typeof value !== "string") return "";
  return /\bP9FIX\b|\[P9TEST:|\[LUNA-EVAL:/.test(value) ? "" : value;
}
