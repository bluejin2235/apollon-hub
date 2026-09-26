import type { SupabaseClient } from "@supabase/supabase-js";

type LinkIdentity = { from_type: string; from_id: string; to_type: string; to_id: string; kind: string };
type LinkWrite = LinkIdentity & {
  confidence: number; evidence: Record<string, unknown>; source: string; status: string;
  confirmed_by?: string | null; confirmed_at?: string | null;
};
const fields = ["from_type", "from_id", "to_type", "to_id", "kind"] as const;
const key = (row: LinkIdentity) => JSON.stringify(fields.map(field => row[field]));
function isLinkIdentity(value: unknown): value is LinkIdentity {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    fields.every(field => typeof (value as Record<string, unknown>)[field] === "string");
}

/** Conflicting inserts are skipped by PostgreSQL, not counted as new relations. */
export async function insertLinkBatch(admin: SupabaseClient, rows: LinkWrite[]): Promise<number> {
  if (rows.length === 0) return 0;
  if (rows.length > 200) throw new Error("Link insert batch exceeds limit");
  const expected = new Set(rows.map(key));
  const { data, error } = await admin.from("luna_links").upsert(rows.map(row => ({
    ...row, confirmed_by: row.confirmed_by ?? null, confirmed_at: row.confirmed_at ?? null
  })), { onConflict: fields.join(","), ignoreDuplicates: true }).select(fields.join(","));
  if (error) throw new Error(`luna_links insert: ${error.message}`);
  const receipts: unknown = data;
  if (!Array.isArray(receipts)) throw new Error("Link insert receipt missing; inspect before retrying");
  const acknowledged = new Set<string>();
  for (const row of receipts) {
    if (!isLinkIdentity(row)) {
      throw new Error("Invalid link insert receipt");
    }
    const identity = key(row);
    if (!expected.has(identity) || acknowledged.has(identity)) throw new Error("Unexpected link insert receipt");
    acknowledged.add(identity);
  }
  return acknowledged.size;
}

export async function updateLinkEvidence(
  admin: SupabaseClient, id: string, confidence: number, evidence: Record<string, unknown>
): Promise<void> {
  const { data, error } = await admin.from("luna_links").update({ confidence, evidence })
    .eq("id", id).select("id").single();
  if (error) throw new Error(`luna_links evidence update: ${error.message}`);
  if (data?.id !== id) throw new Error("Link evidence update receipt mismatch");
}
