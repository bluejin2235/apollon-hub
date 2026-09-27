import type { SupabaseClient } from "@supabase/supabase-js";
import { postgrestTextBatches, postgrestTextList } from "@/lib/luna/postgrest-text-list";

export type NasDirectoryVersion = { path: string; drive: string; modified_at: string; size_bytes: number };
const instant = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const driveOf = (v: unknown) => typeof v === "string" && /^[A-Z]$/.test(v) ? v : null;

/** Current indexed file membership, also usable for image/non-text report sources. */
export async function currentNasDirectoryFiles(admin: SupabaseClient, paths: string[]) {
  const current = new Map<string, NasDirectoryVersion>();
  const latestByDrive = new Map<string, string | null>();
  for (const batch of postgrestTextBatches(paths)) {
    const directory = await admin.from("nas_directory")
      .select("path, drive, modified_at, size_bytes, scan_batch")
      .filter("path", "in", postgrestTextList(batch)).eq("type", "file")
      .order("scan_batch", { ascending: false }).limit(1000);
    if (directory.error || directory.data?.length === 1000) continue;
    const drives = [...new Set((directory.data ?? []).map(row => driveOf(row.drive))
      .filter((drive): drive is string => drive !== null))];
    await Promise.all(drives.filter(drive => !latestByDrive.has(drive)).map(async drive => {
      const latest = await admin.from("nas_directory").select("scan_batch").eq("drive", drive)
        .order("scan_batch", { ascending: false }).limit(1).maybeSingle();
      const stamp = latest.data?.scan_batch;
      latestByDrive.set(drive, !latest.error && typeof stamp === "string" && instant(stamp) !== null ? stamp : null);
    }));
    if (drives.some(drive => !latestByDrive.get(drive))) continue;
    for (const path of batch) {
      const related = (directory.data ?? []).filter(row => row.path === path);
      if (related.some(row => driveOf(row.drive) === null)) continue;
      const live = related.filter(row => typeof row.scan_batch === "string" && row.scan_batch === latestByDrive.get(row.drive));
      // Reject duplicates and cross-drive ambiguity instead of taking the first row.
      if (live.length !== 1) continue;
      const file = live[0]!;
      if (instant(file.modified_at) === null || file.size_bytes == null ||
          !Number.isSafeInteger(Number(file.size_bytes)) || Number(file.size_bytes) < 0) continue;
      current.set(path, { path, drive: file.drive, modified_at: file.modified_at, size_bytes: Number(file.size_bytes) });
    }
  }
  return current;
}
