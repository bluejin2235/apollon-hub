/**
 * Work 본문 청크 임베딩 검색 — nas_file_chunks (노션과 분리)
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingToSql } from "@/lib/luna/embedding";

export const NAS_CHUNK_MATCH_THRESHOLD = 0.3;
export const NAS_CHUNK_MATCH_LIMIT = 24;

export type NasChunkMatchHit = {
  id: string;
  path: string;
  seq: number;
  similarity: number;
  content?: string;
  drive?: string;
};

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const msg = `${error.code ?? ""} ${error.message ?? ""}`;
  return /42883|PGRST202|does not exist|Could not find the function/i.test(msg);
}

/** luna_match_nas_chunks — HNSW. 임베딩 없으면 빈 배열. */
export async function matchNasChunkEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<NasChunkMatchHit[]> {
  const { data, error } = await admin.rpc("luna_match_nas_chunks", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? NAS_CHUNK_MATCH_THRESHOLD,
    match_count: opts?.limit ?? NAS_CHUNK_MATCH_LIMIT
  });
  if (error) {
    if (!isMissingRpc(error)) {
      console.error("[luna/nas-chunk] match rpc", error);
    }
    return [];
  }
  const hits: NasChunkMatchHit[] = (data ?? [])
    .map((row: Record<string, unknown>): NasChunkMatchHit => ({
      id: String(row.id ?? ""),
      path: String(row.path ?? ""),
      seq: Number(row.seq) || 0,
      similarity: Number(row.similarity) || 0
    }))
    .filter(
      (r: NasChunkMatchHit) =>
        Boolean(r.id) &&
        Boolean(r.path) &&
        r.similarity >= NAS_CHUNK_MATCH_THRESHOLD
    );
  if (hits.length === 0) return [];

  const ids = hits.map((h: NasChunkMatchHit) => h.id);
  const { data: rows, error: cErr } = await admin
    .from("nas_file_chunks")
    .select("id, content")
    .in("id", ids);
  if (cErr) {
    console.error("[luna/nas-chunk] content", cErr);
    return [];
  }
  const textById = new Map(
    ((rows ?? []) as { id: string; content: string }[]).map((r) => [
      r.id,
      r.content ?? ""
    ])
  );
  // A relative path is not a usable file location without its indexed drive.
  const { data: files, error: fileError } = await admin
    .from("nas_file_text")
    .select("path, drive")
    .in("path", [...new Set(hits.map(h => h.path))]);
  if (fileError) {
    console.error("[luna/nas-chunk] file metadata", fileError);
    return [];
  }
  const drives = new Map<string, string>();
  for (const file of files ?? []) {
    const drive = String(file.drive ?? "").replace(/:$/, "").toUpperCase();
    if (/^[A-Z]$/.test(drive)) drives.set(String(file.path), drive);
  }
  return hits.filter(h => drives.has(h.path)).map((h) => ({
    ...h,
    drive: drives.get(h.path)!,
    content: textById.get(h.id)?.slice(0, 800)
  }));
}
