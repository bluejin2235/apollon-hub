import { supabase } from "@/lib/supabase/client";

export type OpenAiKeyNameMapRow = {
  id: string;
  tracking_id: string;
  key_name: string;
  created_at: string;
  created_by: string | null;
};

/** tracking_id → key_name 레코드 맵 */
export function toOpenAiKeyNameLookup(rows: Pick<OpenAiKeyNameMapRow, "tracking_id" | "key_name">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const id = row.tracking_id?.trim();
    const name = row.key_name?.trim();
    if (id && name) out[id] = name;
  }
  return out;
}

export async function fetchOpenAiKeyNameMapRows(): Promise<OpenAiKeyNameMapRow[]> {
  const { data, error } = await supabase
    .from("openai_key_name_map")
    .select("id, tracking_id, key_name, created_at, created_by")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[openai_key_name_map] fetch failed", error);
    throw new Error(error.message);
  }

  return (data ?? []) as OpenAiKeyNameMapRow[];
}

export async function fetchOpenAiKeyNameLookup(): Promise<Record<string, string>> {
  const rows = await fetchOpenAiKeyNameMapRows();
  return toOpenAiKeyNameLookup(rows);
}

export function resolveOpenAiKeyLabel(trackingId: string, lookup: Record<string, string>): string {
  const raw = trackingId.trim();
  if (!raw) return "—";
  return lookup[raw] ?? raw;
}
