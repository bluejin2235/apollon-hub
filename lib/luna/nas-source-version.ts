import { postgrestTextBatches, postgrestTextList } from "@/lib/luna/postgrest-text-list";
import { currentNasDirectoryFiles } from "@/lib/luna/nas-directory-version";
import type { SupabaseClient } from "@supabase/supabase-js";

type FileVersion = { path: string; drive: string; modified_at: string; size_bytes: number; status?: string };
const instant = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;

/** Indexed metadata check, not a live NAS read or chunk-content hash guarantee. */
export async function currentNasBodyFiles(admin: SupabaseClient, paths: string[]): Promise<Map<string, FileVersion>> {
  const current = new Map<string, FileVersion>();
  for (const batch of postgrestTextBatches(paths)) {
    const [texts, directory] = await Promise.all([
      admin.from("nas_file_text").select("path, drive, modified_at, size_bytes, status")
        .filter("path", "in", postgrestTextList(batch)).limit(1000),
      currentNasDirectoryFiles(admin, batch)
    ]);
    if (texts.error || texts.data?.length === 1000) continue;
    for (const path of batch) {
      const extracted = (texts.data ?? []).filter(row => row.path === path);
      if (extracted.length !== 1) continue;
      const text = extracted[0];
      const file = directory.get(path);
      if (!file || text.drive !== file.drive || text.status !== "ok" ||
          instant(text.modified_at) === null || instant(text.modified_at) !== instant(file.modified_at) ||
          text.size_bytes == null || Number(text.size_bytes) !== file.size_bytes) continue;
      current.set(path, { path, drive: file.drive, modified_at: text.modified_at, size_bytes: file.size_bytes, status: "ok" });
    }
  }
  return current;
}
