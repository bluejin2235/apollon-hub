import type { SupabaseClient } from "@supabase/supabase-js";
import { describeNasError } from "@/lib/luna/nas-error";

export type NasTextPublication = {
  path: string; drive: string; ext: string;
  size_bytes: number | null; modified_at: string | null;
  content_hash: string | null; text_length: number; chunk_count: number;
  status: "ok" | "empty" | "failed" | "skipped";
  skip_reason: string | null; error: string | null; extracted_at: string;
};

/** No direct-write fallback and no automatic retry after an uncertain commit. */
export async function publishNasText(
  admin: SupabaseClient, meta: NasTextPublication, chunks: string[],
  expectedUpdatedAt: string | null
): Promise<number> {
  const { data, error } = await admin.rpc("nas_text_publish", {
    p_meta: meta,
    p_chunks: chunks.map(content => content.replace(/\u0000/g, "")),
    p_expected_updated_at: expectedUpdatedAt
  });
  if (error) throw new Error(`NAS publication failed: ${describeNasError(error, 400)}`);
  if (!data || !Number.isInteger(data.chunks_created) || data.chunks_created < 0 ||
      data.chunks_created > chunks.length || typeof data.updated_at !== "string") {
    throw new Error("NAS publication returned an invalid receipt; inspect before retrying");
  }
  return data.chunks_created;
}
