import type { SupabaseClient } from "@supabase/supabase-js";
import { describeNasError } from "@/lib/luna/nas-error";

export type NasEmbeddingCandidate = {
  id: string; path: string; seq: number; content: string; source_version: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function candidates(data: unknown, cap: number): NasEmbeddingCandidate[] {
  if (!Array.isArray(data) || data.length > cap || data.some(row => !row ||
    typeof row.id !== "string" || !uuid.test(row.id) || typeof row.path !== "string" || !row.path ||
    !Number.isInteger(row.seq) || row.seq < 0 || typeof row.content !== "string" || !row.content.trim() ||
    typeof row.source_version !== "string" || !Number.isFinite(Date.parse(row.source_version)))) {
    throw new Error("Invalid NAS embedding queue response");
  }
  if (new Set(data.map(row => row.id)).size !== data.length) throw new Error("Duplicate embedding queue IDs");
  return data;
}
export async function selectNasEmbeddingQueue(admin: SupabaseClient, limit: number): Promise<NasEmbeddingCandidate[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error("Invalid embedding queue limit");
  const out: NasEmbeddingCandidate[] = [];
  let after: string | null = null;
  while (out.length < limit) {
    const take = Math.min(500, limit - out.length);
    const { data, error } = await admin.rpc("nas_embedding_candidates", { p_limit: take, p_after_id: after });
    if (error) throw new Error(`Embedding queue read failed: ${describeNasError(error)}`);
    const page = candidates(data, take);
    for (const row of page) {
      if (after !== null && row.id <= after) throw new Error("Embedding queue cursor did not advance");
      out.push(row); after = row.id;
    }
    if (page.length < take) break;
  }
  return out;
}
/** Recheck immediately before paying, preserving the original order and revision. */
export async function revalidateNasEmbeddingBatch(admin: SupabaseClient, batch: NasEmbeddingCandidate[]) {
  if (batch.length < 1 || batch.length > 100) throw new Error("Invalid embedding revalidation batch");
  const { data, error } = await admin.rpc("nas_embedding_candidates", { p_limit: 100, p_ids: batch.map(row => row.id) });
  if (error) throw new Error(`Embedding revalidation failed: ${describeNasError(error)}`);
  const current = new Map(candidates(data, 100).map(row => [row.id, row]));
  return batch.filter(row => {
    const now = current.get(row.id);
    return now && now.path === row.path && now.seq === row.seq && now.content === row.content &&
      now.source_version === row.source_version;
  });
}
export async function storeNasEmbeddingBatch(admin: SupabaseClient, batch: NasEmbeddingCandidate[], vectors: number[][]) {
  if (!batch.length || batch.length > 100 || vectors.length !== batch.length || vectors.some(v =>
    !Array.isArray(v) || v.length !== 1536 || v.some(n => !Number.isFinite(n)) || !v.some(n => n !== 0))) {
    throw new Error("Invalid embedding store batch");
  }
  const { data, error } = await admin.rpc("nas_embedding_store_batch", { p_rows: batch.map((row, i) => ({
    ...row, embedding: `[${vectors[i]!.join(",")}]`
  })) });
  if (error) throw new Error(`Embedding storage failed: ${describeNasError(error)}`);
  const expected = new Set(batch.map(row => row.id));
  if (!Array.isArray(data) || new Set(data).size !== data.length || data.some(id => !expected.has(id))) {
    throw new Error("Invalid embedding storage receipt; inspect before retrying");
  }
  return data.length;
}
