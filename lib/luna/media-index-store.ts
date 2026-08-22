import type { SupabaseClient } from "@supabase/supabase-js";

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
