import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkserverExploreRow } from "@/lib/luna/workserver-explore";
import { searchNasTextKeyword } from "@/lib/luna/nas-text-keyword";
import { matchNasChunkEmbeddings } from "@/lib/luna/nas-chunk-search";
import { mergeNasTextEvidence } from "@/lib/luna/nas-evidence";
import { runWorkserverResultPipeline } from "@/lib/luna/workserver";

/** Shared production/evaluation body retrieval. Reuses an existing query embedding. */
export async function retrieveNasBodyEvidence(
  admin: SupabaseClient,
  opts: {
    enabled: boolean;
    listing: boolean;
    notionEnough: boolean;
    query: string;
    queryEmbedding: number[] | null;
    rows: WorkserverExploreRow[];
  }
) {
  if (!opts.enabled || opts.listing || opts.notionEnough) {
    return { rows: opts.rows, searched: false, keywordHits: 0, vectorHits: 0 };
  }
  const [keyword, vector] = await Promise.allSettled([
    searchNasTextKeyword(admin, opts.query, { limit: 12 }),
    opts.queryEmbedding?.length
      ? matchNasChunkEmbeddings(admin, opts.queryEmbedding, { limit: 12 })
      : Promise.resolve([])
  ]);
  if (keyword.status === "rejected") console.error("[luna/nas-body] keyword", keyword.reason);
  if (vector.status === "rejected") console.error("[luna/nas-body] vector", vector.reason);
  const kw = keyword.status === "fulfilled" ? keyword.value : [];
  const vec = vector.status === "fulfilled" ? vector.value : [];
  let rows = opts.rows;
  if (kw.length) rows = runWorkserverResultPipeline(mergeNasTextEvidence(rows, kw.map(hit => ({
    drive: hit.drive, path: hit.path, type: "file", size_bytes: null,
    modified_at: hit.modified_at, file_summary: hit.snippet, importance: hit.score
  }))));
  if (vec.length) rows = runWorkserverResultPipeline(mergeNasTextEvidence(rows, vec.map(hit => ({
    drive: hit.drive ?? null, path: hit.path, type: "file", size_bytes: null,
    modified_at: null, file_summary: hit.content?.slice(0, 800) ?? null, importance: hit.similarity
  }))));
  return { rows, searched: true, keywordHits: kw.length, vectorHits: vec.length };
}
