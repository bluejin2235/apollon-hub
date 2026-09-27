import type { WorkserverExploreRow } from "@/lib/luna/workserver-explore";

const pathKey = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const driveKey = (drive: string | null) => (drive ?? "").replace(/:$/, "").toUpperCase();

/** Preserve matching text when a directory search already returned the file. */
export function mergeNasTextEvidence(
  existing: WorkserverExploreRow[],
  incoming: WorkserverExploreRow[]
): WorkserverExploreRow[] {
  const out = existing.map(row => ({ ...row }));
  for (const hit of incoming) {
    const candidates = out.filter(row => pathKey(row.path) === pathKey(hit.path) &&
      (!driveKey(hit.drive) || !driveKey(row.drive) || driveKey(row.drive) === driveKey(hit.drive)));
    // A path without a drive cannot distinguish identical T/P relative paths.
    if (candidates.length > 1) continue;
    const row = candidates[0];
    if (!row) { out.push({ ...hit }); continue; }
    const snippet = hit.file_summary?.trim();
    if (!snippet) continue;
    const previous = row.file_summary?.trim();
    row.file_summary = previous && !previous.includes(snippet)
      ? `${previous.slice(0, 400)}\n${snippet.slice(0, 800)}`
      : (previous || snippet).slice(0, 1200);
    if (!row.drive && hit.drive) row.drive = hit.drive;
  }
  return out;
}
