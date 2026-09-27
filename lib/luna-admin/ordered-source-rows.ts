import type { SupabaseClient } from "@supabase/supabase-js";

// Actual primary keys; every page must use the same unique ordering.
const PRIMARY_KEYS = {
  nas_directory: ["id"],
  luna_notion_pages: ["page_id"],
  luna_media_index: ["path"],
  luna_notion_relations: ["from_page_id", "to_page_id", "property_name"],
  glossary_terms: ["id"],
  luna_library: ["id"],
  luna_notion_chunks: ["chunk_id"],
  luna_perspectives: ["id"],
  luna_questions: ["id"]
} as const;

/** Stable pagination, not a database snapshot across concurrent source updates. */
export async function fetchOrderedSourceRows<T>(
  admin: SupabaseClient,
  table: keyof typeof PRIMARY_KEYS,
  columns: string,
  pageSize = 1000
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Invalid source page size");
  }
  const keys = PRIMARY_KEYS[table];
  const projection = [...new Set([...columns.split(",").map(c => c.trim()), ...keys])].join(", ");
  const out: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    let query = admin.from(table).select(projection);
    for (const key of keys) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`${table}: missing source page`);
    for (const row of data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`${table}: invalid source row`);
      }
      const source = row as unknown as Record<string, unknown>;
      const values = keys.map(key => source[key]);
      if (values.some(value => typeof value !== "string" &&
          !(typeof value === "number" && Number.isFinite(value)))) {
        throw new Error(`${table}: invalid source identity`);
      }
      const identity = JSON.stringify(values);
      if (seen.has(identity)) throw new Error(`${table}: repeated source identity; retry after source updates finish`);
      seen.add(identity);
      out.push(row as T);
    }
    if (data.length < pageSize) return out;
  }
}
