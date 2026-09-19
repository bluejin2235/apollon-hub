import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  DEFAULT_SCAN_ROOT,
  DEFAULT_SCAN_ROOTS,
  DESIGN_SKIP_EXTENSIONS,
  DUP_FILENAME_RE,
  EXCLUDE_FOLDER_PATTERNS,
  FULL_INCLUDE_PATH_PREFIXES,
  IMAGE_EXTENSIONS,
  MIN_FILE_BYTES,
  PRIORITY_FOLDER_PATTERNS,
  RECENT_PROJECT_YEARS,
  VIDEO_CAPTURE_FILENAME_RE,
  VIDEO_CAPTURE_PREFIX_LEN,
  VIDEO_CAPTURE_PREFIX_MIN_COUNT
} from "@/lib/luna/media-index-rules";
import {
  normalizeWorkPath,
  splitDrivePath
} from "@/lib/luna/media-path-parse";

export type ClassifyResult =
  | { ok: true; includeRule: string }
  | { ok: false; reason: string };

export type ScanCandidate = {
  fullPath: string;
  drive: string;
  /** nas_directory 와 동일 — 드라이브 문자 없음 */
  path: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
  includeRule: string;
  projectFolder: string | null;
  /** 1=important · 2=recent year · 3=ref/kv · 4=rest */
  priority: 1 | 2 | 3 | 4;
};

export type ScanStats = {
  candidates: ScanCandidate[];
  excluded: Record<string, number>;
  byProject: Record<string, number>;
  byIncludeRule: Record<string, number>;
  byPriority: Record<string, number>;
  totalFilesSeen: number;
};

export type CollectMediaOpts = {
  /** true 면 예전처럼 시범 3프로젝트만 (디버그) */
  pilotOnly?: boolean;
  pilotFolders?: readonly string[];
  /** nas_important_paths 의 path (드라이브 없는 relative) */
  importantPathPrefixes?: string[];
};

function pathForRules(fullPath: string): string {
  const { relativePath } = splitDrivePath(fullPath);
  return normalizeWorkPath(relativePath);
}

function matchesExclude(relPath: string): { id: string } | null {
  for (const row of EXCLUDE_FOLDER_PATTERNS) {
    if (row.id === "capture" && /ref\s*image/i.test(relPath)) continue;
    if (row.re.test(relPath)) return { id: row.id };
  }
  return null;
}

function matchPriorityFolder(relPath: string): string | null {
  for (const prefix of FULL_INCLUDE_PATH_PREFIXES) {
    if (relPath.toLowerCase().startsWith(prefix.toLowerCase())) {
      return "full_tree";
    }
  }
  for (const row of PRIORITY_FOLDER_PATTERNS) {
    if (row.re.test(relPath)) return row.id;
  }
  return null;
}

export function isVideoCaptureFilename(fileName: string): boolean {
  return VIDEO_CAPTURE_FILENAME_RE.test(fileName);
}

function folderKeyFromRelativePath(relativePath: string): string {
  return dirname(relativePath).replace(/\\/g, "/");
}

export function videoCaptureSequencePaths(
  rows: Array<{ fullPath: string; path: string; fileName: string }>
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const prefix = row.fileName.slice(0, VIDEO_CAPTURE_PREFIX_LEN);
    if (
      !/\.(mp4|mov|mkv|avi|wmv|m4v|ts)_/i.test(prefix) &&
      !/\.(mp4|mov|mkv|avi|wmv|m4v|ts)/i.test(prefix)
    ) {
      continue;
    }
    const key = `${folderKeyFromRelativePath(row.path)}\0${prefix}`;
    const list = groups.get(key) ?? [];
    list.push(row.fullPath);
    groups.set(key, list);
  }
  const excluded = new Set<string>();
  for (const paths of groups.values()) {
    if (paths.length >= VIDEO_CAPTURE_PREFIX_MIN_COUNT) {
      for (const p of paths) excluded.add(p);
    }
  }
  return excluded;
}

/**
 * 같은 폴더에서 파일명+크기 동일 → 최신 mtime 1장만 남김.
 * (중복 파일명 규칙)
 */
function duplicatePathSet(
  rows: Array<{
    fullPath: string;
    path: string;
    fileName: string;
    sizeBytes: number;
    mtimeMs: number;
  }>
): Set<string> {
  const groups = new Map<
    string,
    Array<{ fullPath: string; mtimeMs: number }>
  >();
  for (const row of rows) {
    const folder = folderKeyFromRelativePath(row.path);
    const key = `${folder}\0${row.fileName.toLowerCase()}\0${row.sizeBytes}`;
    const list = groups.get(key) ?? [];
    list.push({ fullPath: row.fullPath, mtimeMs: row.mtimeMs });
    groups.set(key, list);
  }
  const drop = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const row of list.slice(1)) drop.add(row.fullPath);
  }
  return drop;
}

function classifyMediaFileBase(
  fullPath: string,
  sizeBytes: number
): ClassifyResult {
  const ext = extname(fullPath).slice(1).toLowerCase();
  if (DESIGN_SKIP_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "ext:design_skip" };
  }
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "ext" };
  }
  if (sizeBytes < MIN_FILE_BYTES) {
    return { ok: false, reason: "size" };
  }

  const fileName = basename(fullPath);
  if (DUP_FILENAME_RE.test(fileName)) {
    return { ok: false, reason: "exclude:dup_filename" };
  }

  const rel = pathForRules(fullPath);
  const ex = matchesExclude(rel);
  if (ex) return { ok: false, reason: `exclude:${ex.id}` };

  const tag = matchPriorityFolder(rel) ?? "all";
  return { ok: true, includeRule: tag };
}

export function classifyMediaFile(
  fullPath: string,
  sizeBytes: number
): ClassifyResult {
  const base = classifyMediaFileBase(fullPath, sizeBytes);
  if (!base.ok) return base;
  if (isVideoCaptureFilename(basename(fullPath))) {
    return { ok: false, reason: "exclude:video_capture_name" };
  }
  return base;
}

export function mediaFileTypeFromExt(fullPath: string): "image" | "design" {
  const ext = extname(fullPath).slice(1).toLowerCase();
  if (ext === "psd" || ext === "ai") return "design";
  return "image";
}

function projectFromPath(relativePath: string): string | null {
  const parts = relativePath.split("\\");
  for (const seg of parts) {
    if (/^\d{6}\s+/.test(seg)) return seg;
  }
  return null;
}

function isRecentProjectPath(relativePath: string): boolean {
  if (/\\02 Project\\(2024|2025|2026)\\/i.test(relativePath)) return true;
  if (/^02 Project\\(2024|2025|2026)\\/i.test(relativePath)) return true;
  const proj = projectFromPath(relativePath);
  if (!proj) return false;
  const yy = parseInt(proj.slice(0, 2), 10);
  if (!Number.isFinite(yy)) return false;
  const year = 2000 + yy;
  return (RECENT_PROJECT_YEARS as readonly number[]).includes(year);
}

function isUnderImportant(
  relativePath: string,
  prefixes: string[] | undefined
): boolean {
  if (!prefixes || prefixes.length === 0) return false;
  const norm = relativePath.replace(/\//g, "\\").toLowerCase();
  for (const raw of prefixes) {
    const p = raw.replace(/\//g, "\\").replace(/^([A-Za-z]:\\)/, "").toLowerCase();
    if (!p) continue;
    if (norm === p || norm.startsWith(p.endsWith("\\") ? p : `${p}\\`)) {
      return true;
    }
  }
  return false;
}

function assignPriority(
  relativePath: string,
  includeRule: string,
  importantPrefixes?: string[]
): 1 | 2 | 3 | 4 {
  if (isUnderImportant(relativePath, importantPrefixes)) return 1;
  if (isRecentProjectPath(relativePath)) return 2;
  if (includeRule !== "all") return 3;
  return 4;
}

function shouldPruneDir(fullPath: string): boolean {
  const rel = pathForRules(fullPath);
  if (!rel) return false;
  // 디렉터리 진입 전에 제외 — 전수 walk 가 멈추지 않게
  if (matchesExclude(rel)) return true;
  if (/\\#recycle|\\\$recycle|_d5c|\\temp\\|\\tmp\\/i.test(fullPath)) {
    return true;
  }
  return false;
}

function walkDir(dir: string, out: string[], depth = 0): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  if (depth <= 2) {
    console.log(`[walk] ${dir} (${entries.length} entries)`);
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        if (shouldPruneDir(full)) continue;
        walkDir(full, out, depth + 1);
      } else if (st.isFile()) {
        out.push(full);
      }
    } catch {
      /* permission */
    }
  }
}

/** @deprecated 시범용 */
export const PILOT_PROJECT_FOLDERS_LEGACY = [
  "260129 삼성디스플레이 시어터룸",
  "260713 더후 글로벌 론칭",
  "260723 아크메르동탄 모델하우스"
] as const;

export function collectMediaCandidates(
  root: string | string[],
  opts?: CollectMediaOpts
): ScanStats {
  const roots = Array.isArray(root) ? root : [root];
  const allFiles: string[] = [];
  if (opts?.pilotOnly) {
    const folders = opts.pilotFolders ?? PILOT_PROJECT_FOLDERS_LEGACY;
    const base = roots[0] ?? DEFAULT_SCAN_ROOT;
    for (const name of folders) {
      walkDir(join(base, name), allFiles);
    }
  } else {
    for (const r of roots) {
      walkDir(r, allFiles);
    }
  }

  const stats: ScanStats = {
    candidates: [],
    excluded: {},
    byProject: {},
    byIncludeRule: {},
    byPriority: {},
    totalFilesSeen: allFiles.length
  };

  const preCandidates: ScanCandidate[] = [];

  for (const fullPath of allFiles) {
    let sizeBytes = 0;
    let mtimeMs = 0;
    try {
      const st = statSync(fullPath);
      sizeBytes = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      stats.excluded.access = (stats.excluded.access ?? 0) + 1;
      continue;
    }

    const verdict = classifyMediaFileBase(fullPath, sizeBytes);
    if (!verdict.ok) {
      stats.excluded[verdict.reason] = (stats.excluded[verdict.reason] ?? 0) + 1;
      continue;
    }

    const { drive, relativePath } = splitDrivePath(fullPath);
    preCandidates.push({
      fullPath,
      drive,
      path: relativePath,
      fileName: basename(fullPath),
      sizeBytes,
      mtimeMs,
      includeRule: verdict.includeRule,
      projectFolder: projectFromPath(relativePath),
      priority: assignPriority(
        relativePath,
        verdict.includeRule,
        opts?.importantPathPrefixes
      )
    });
  }

  const sequencePaths = videoCaptureSequencePaths(preCandidates);
  const dupPaths = duplicatePathSet(preCandidates);

  for (const row of preCandidates) {
    if (isVideoCaptureFilename(row.fileName)) {
      stats.excluded["exclude:video_capture_name"] =
        (stats.excluded["exclude:video_capture_name"] ?? 0) + 1;
      continue;
    }
    if (sequencePaths.has(row.fullPath)) {
      stats.excluded["exclude:video_capture_seq"] =
        (stats.excluded["exclude:video_capture_seq"] ?? 0) + 1;
      continue;
    }
    if (dupPaths.has(row.fullPath)) {
      stats.excluded["exclude:dup_same_folder"] =
        (stats.excluded["exclude:dup_same_folder"] ?? 0) + 1;
      continue;
    }

    stats.candidates.push(row);
    const pk = row.projectFolder ?? "(unknown)";
    stats.byProject[pk] = (stats.byProject[pk] ?? 0) + 1;
    stats.byIncludeRule[row.includeRule] =
      (stats.byIncludeRule[row.includeRule] ?? 0) + 1;
    const pkey = String(row.priority);
    stats.byPriority[pkey] = (stats.byPriority[pkey] ?? 0) + 1;
  }

  stats.candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.mtimeMs - a.mtimeMs;
  });

  return stats;
}

/** dry-run 후 보고 */
export function printMediaDryRunReport(stats: ScanStats, root: string): void {
  const n = stats.candidates.length;
  console.log("\n=== LUNA media index dry-run ===");
  console.log(`root: ${root}`);
  console.log(`파일 열람: ${stats.totalFilesSeen.toLocaleString("ko-KR")}`);
  console.log(`색인 대상: ${n.toLocaleString("ko-KR")}장\n`);

  console.log("--- 우선순위별 ---");
  const labels: Record<string, string> = {
    "1": "① important_paths",
    "2": "② 최근 3년 프로젝트",
    "3": "③ 레퍼런스·아이데이션·KV·소스",
    "4": "④ 나머지"
  };
  for (const key of ["1", "2", "3", "4"]) {
    const cnt = stats.byPriority[key] ?? 0;
    console.log(`  ${labels[key]}: ${cnt.toLocaleString("ko-KR")}장`);
  }

  console.log("\n--- 프로젝트별 (상위 20) ---");
  const projects = Object.entries(stats.byProject).sort((a, b) => b[1] - a[1]);
  for (const [proj, cnt] of projects.slice(0, 20)) {
    console.log(`  ${proj}: ${cnt.toLocaleString("ko-KR")}장`);
  }
  if (projects.length > 20) {
    console.log(`  … 외 ${projects.length - 20}개 프로젝트`);
  }

  console.log("\n--- 폴더 태그별 ---");
  for (const [rule, cnt] of Object.entries(stats.byIncludeRule).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${rule}: ${cnt.toLocaleString("ko-KR")}장`);
  }

  console.log("\n--- 제외 (사유별) ---");
  let excludedTotal = 0;
  for (const [reason, cnt] of Object.entries(stats.excluded).sort(
    (a, b) => b[1] - a[1]
  )) {
    excludedTotal += cnt;
    console.log(`  ${reason}: ${cnt.toLocaleString("ko-KR")}장`);
  }
  console.log(`  합계 제외: ${excludedTotal.toLocaleString("ko-KR")}장`);

  const visionSec = 4.6;
  const totalSec = n * visionSec;
  const hours = totalSec / 3600;
  const visionUsdPerImage = 0.0057;
  const estUsd = n * visionUsdPerImage;

  console.log("\n--- 추정 (9/17 실측 환산, 참고) ---");
  console.log(
    `  시간: 약 ${hours.toFixed(1)}시간 (장당 ~${visionSec}초)`
  );
  console.log(`  비용: 약 $${estUsd.toFixed(2)} (장당 ~$${visionUsdPerImage})`);
  console.log("");
}

export function writeMediaDryRunJson(
  stats: ScanStats,
  root: string,
  outDir: string
): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "media-index-dry-run.json");
  writeFileSync(
    file,
    JSON.stringify(
      {
        root,
        generated_at: new Date().toISOString(),
        total_files_seen: stats.totalFilesSeen,
        candidate_count: stats.candidates.length,
        by_priority: stats.byPriority,
        by_project: stats.byProject,
        by_include_rule: stats.byIncludeRule,
        excluded: stats.excluded
      },
      null,
      2
    ),
    "utf8"
  );
  return file;
}

export function sampleCandidatesByIncludeRule(
  candidates: ScanCandidate[],
  limit: number,
  opts?: { maxPerFolder?: number }
): ScanCandidate[] {
  if (limit >= candidates.length) return candidates;

  const maxPerFolder = opts?.maxPerFolder ?? Number.POSITIVE_INFINITY;
  const folderOf = (c: ScanCandidate) =>
    c.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");

  const buckets = new Map<string, ScanCandidate[]>();
  for (const c of candidates) {
    const list = buckets.get(c.includeRule) ?? [];
    list.push(c);
    buckets.set(c.includeRule, list);
  }

  const rules = [...buckets.keys()].sort();
  const out: ScanCandidate[] = [];
  const folderCounts = new Map<string, number>();
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const rule of rules) {
      const bucket = buckets.get(rule)!;
      if (round < bucket.length) {
        const cand = bucket[round]!;
        const folder = folderOf(cand);
        const n = folderCounts.get(folder) ?? 0;
        if (n < maxPerFolder) {
          out.push(cand);
          folderCounts.set(folder, n + 1);
          if (out.length >= limit) break;
        }
        added = true;
      }
    }
    if (!added) break;
    round++;
  }
  return out;
}

export { DEFAULT_SCAN_ROOT as DEFAULT_PILOT_ROOT, DEFAULT_SCAN_ROOT, DEFAULT_SCAN_ROOTS };
