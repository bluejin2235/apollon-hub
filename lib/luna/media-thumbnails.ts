import type { SupabaseClient } from "@supabase/supabase-js";
import { THUMB_BUCKET } from "@/lib/luna/media-index-rules";

/** Storage 키 — 경로 그대로, 파일명 불가 문자 치환 */
export function storageKeyFromPath(drive: string, relativePath: string): string {
  const raw = `${drive}/${relativePath}`;
  return raw
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/._\-+]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 500);
}

export async function uploadMediaThumbnail(
  supabase: SupabaseClient,
  key: string,
  data: Buffer
): Promise<string> {
  const path = `${key}.webp`;
  const { error } = await supabase.storage.from(THUMB_BUCKET).upload(path, data, {
    contentType: "image/webp",
    upsert: true
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(THUMB_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

export async function uploadMediaLarge(
  supabase: SupabaseClient,
  key: string,
  data: Buffer
): Promise<string> {
  const path = `${key}.large.webp`;
  const { error } = await supabase.storage.from(THUMB_BUCKET).upload(path, data, {
    contentType: "image/webp",
    upsert: true
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(THUMB_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}
