import { postgrestTextBatches, postgrestTextList } from "@/lib/luna/postgrest-text-list";
import type { SupabaseClient } from "@supabase/supabase-js";

type FileVersion = { path: string; drive: string; modified_at: string; size_bytes: number; status?: string };
const instant = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const driveOf = (v: unknown) => typeof v === "string" && /^[A-Z]$/.test(v) ? v : null;

/** Indexed metadata check, not a live NAS read or chunk-content hash guarantee. */
export async function currentNasBodyFiles(admin: SupabaseClient, paths: string[]): Promise<Map<string, FileVersion>> {
  const current = new Map<string, FileVersion>();
  for (const batch of postgrestTextBatches(paths)) {
    const [texts, directory] = await Promise.all([
      admin.from("nas_file_text").select("path, drive, modified_at, size_bytes, status").filter("path", "in", postgrestTextList(batch)).limit(1000),
      admin.from("nas_directory").select("path, drive, modified_at, size_bytes, scan_batch").filter("path", "in", postgrestTextList(batch))
        .eq("type", "file").order("scan_batch", { ascending: false }).limit(1000)
    ]);
    // Truncated/failed provenance cannot establish freshness.
    if (texts.error || directory.error || texts.data?.length === 1000 || directory.data?.length === 1000) continue;
    for (const path of batch) {
      const extracted = (texts.data ?? []).filter(row => row.path === path);
      if (extracted.length !== 1) continue;
      const text = extracted[0];
      const drive = driveOf(text.drive);
      if (!drive || text.status !== "ok" || instant(text.modified_at) === null ||
        text.size_bytes === null || !Number.isSafeInteger(Number(text.size_bytes)) || Number(text.size_bytes) < 0) continue;
      const versions = (directory.data ?? []).filter(row => row.path === path && row.drive === drive);
      // Coexisting generations must agree before a body is considered current.
      if (!versions.length || versions.some(row => instant(row.modified_at) !== instant(text.modified_at) ||
        row.size_bytes === null || Number(row.size_bytes) !== Number(text.size_bytes))) continue;
      current.set(path, { path, drive, modified_at: text.modified_at, size_bytes: Number(text.size_bytes), status: "ok" });
    }
  }
  return current;
}
