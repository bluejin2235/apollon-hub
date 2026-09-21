import type { SupabaseClient } from "@supabase/supabase-js";
import { isGarbage3dPath } from "@/lib/luna/media-index-rules";

export type MediaIndexRow = {
  path: string;
  drive: string;
  file_name: string;
  file_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  file_mtime: string;
  project: string | null;
  stage: string | null;
  author: string | null;
  folder_category: string | null;
  ai_category: string | null;
  purpose: string | null;
  description: string | null;
  description_model: string | null;
  thumbnail_url: string | null;
  large_url: string | null;
  embedding?: string | null;
  content_hash: string | null;
  indexed_at: string;
};

export async function fetchIndexedMtime(
  admin: SupabaseClient,
  path: string
): Promise<{ mtime: string | null; contentHash: string | null }> {
  const { data, error } = await admin
    .from("luna_media_index")
    .select("file_mtime, content_hash")
    .eq("path", path)
    .maybeSingle();
  if (error || !data) return { mtime: null, contentHash: null };
  return {
    mtime: data.file_mtime as string | null,
    contentHash: data.content_hash as string | null
  };
}

export async function upsertMediaIndex(
  admin: SupabaseClient,
  row: MediaIndexRow
): Promise<void> {
  const { error } = await admin.from("luna_media_index").upsert(row, {
    onConflict: "path"
  });
  if (error) throw error;
}

export async function updateMediaLargeUrl(
  admin: SupabaseClient,
  path: string,
  largeUrl: string
): Promise<void> {
  const { error } = await admin
    .from("luna_media_index")
    .update({ large_url: largeUrl })
    .eq("path", path);
  if (error) throw error;
}

export type MediaIndexLargeRebuildRow = {
  path: string;
  drive: string;
  width: number | null;
  height: number | null;
  large_url: string | null;
};

export async function fetchMediaIndexForLargeRebuild(
  admin: SupabaseClient
): Promise<MediaIndexLargeRebuildRow[]> {
  const { data, error } = await admin
    .from("luna_media_index")
    .select("path, drive, width, height, large_url")
    .order("indexed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MediaIndexLargeRebuildRow[];
}

/** 이미 색인된 SKP·asset·ModelTextures·D5용 레이어분리 행 삭제 */
export async function deleteGarbage3dMediaRows(
  admin: SupabaseClient,
  opts?: { limit?: number }
): Promise<{ deleted: number; samples: string[] }> {
  const patterns = ["%SKP%", "%ModelTextures%", "%asset%", "%D5용%"];
  const page = Math.min(opts?.limit ?? 2000, 2000);
  let deleted = 0;
  const samples: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (;;) {
      const { data, error } = await admin
        .from("luna_media_index")
        .select("path")
        .ilike("path", pattern)
        .limit(page);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ path: string }>;
      const paths = rows
        .map((r) => r.path)
        .filter((p) => p && !seen.has(p) && isGarbage3dPath(p));
      if (paths.length === 0) break;
      for (const p of paths) seen.add(p);
      for (let i = 0; i < paths.length; i += 200) {
        const chunk = paths.slice(i, i + 200);
        const { error: delErr } = await admin
          .from("luna_media_index")
          .delete()
          .in("path", chunk);
        if (delErr) throw delErr;
        deleted += chunk.length;
        if (samples.length < 8) {
          samples.push(...chunk.slice(0, 8 - samples.length));
        }
      }
      if (rows.length < page) break;
    }
  }
  return { deleted, samples };
}
