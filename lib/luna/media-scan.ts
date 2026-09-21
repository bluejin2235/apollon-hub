import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  CAMERA_FILENAME_RE,
  CAMERA_ORIGIN_PATH_RE,
  DEFAULT_SCAN_ROOT,
  DEFAULT_SCAN_ROOTS,
  DESIGN_SKIP_EXTENSIONS,
  DUP_FILENAME_RE,
  EXCLUDE_FILENAME_PATTERNS,
  EXCLUDE_FOLDER_PATTERNS,
  FULL_INCLUDE_PATH_PREFIXES,
  HARD_EXCLUDE_FILENAME_IDS,
  HARD_EXCLUDE_FOLDER_IDS,
  IMAGE_EXTENSIONS,
  KEEP_PATH_PATTERNS,
  MIN_FILE_BYTES,
  NEW_CHUNK_FOLDER_MIN,
  PRIORITY_FOLDER_PATTERNS,
  RECENT_PROJECT_YEARS,
  SEQUENCE_MIN_COUNT,
  VIDEO_CAPTURE_FILENAME_RE,
  VIDEO_CAPTURE_PREFIX_LEN,
  VIDEO_CAPTURE_PREFIX_MIN_COUNT,
  matchAssetFolderExclude
} from "@/lib/luna/media-index-rules";
import {
  normalizeWorkPath,
  splitDrivePath
} from "@/lib/luna/media-path-parse";

export type ClassifyResult =
  | { ok: true; includeRule: string; kept?: string }
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
  keptBy?: string;
};

export type ScanStats = {
  candidates: ScanCandidate[];
  excluded: Record<string, number>;
  kept: Record<string, number>;
  byProject: Record<string, number>;
  byIncludeRule: Record<string, number>;
  byPriority: Record<string, number>;
  totalFilesSeen: number;
  /** 폴더당 이미지 ≥ NEW_CHUNK_FOLDER_MIN (후보 기준) */
  bigFolders: Array<{
    folder: string;
    count: number;
    samples: string[];
  }>;
};

export type CollectMediaOpts = {
  pilotOnly?: boolean;
  pilotFolders?: readonly string[];
  importantPathPrefixes?: string[];
};

function pathForRules(fullPath: string): string {
  const { relativePath } = splitDrivePath(fullPath);
  return normalizeWorkPath(relativePath);
}

export function matchKeepPath(relPath: string): { id: string } | null {
  for (const row of KEEP_PATH_PATTERNS) {
    if (row.re.test(relPath)) return { id: row.id };
  }
  return null;
}

function matchesExclude(relPath: string): { id: string } | null {
  for (const row of EXCLUDE_FOLDER_PATTERNS) {
    if (row.id === "capture" && /ref\s*image/i.test(relPath)) continue;
    if (row.re.test(relPath)) return { id: row.id };
  }
  return null;
}

function matchFilenameExclude(fileName: string): { id: string } | null {
  for (const row of EXCLUDE_FILENAME_PATTERNS) {
    if (row.re.test(fileName)) return { id: row.id };
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

/** 연속 번호 접두사 — foo_001.jpg → foo_ */
export function sequencePrefix(fileName: string): string | null {
  const m = fileName.match(/^(.*?)(\d{2,})(\.[^.]+)$/);
  if (!m) return null;
  const prefix = (m[1] ?? "").toLowerCase();
  if (prefix.length < 1) return null;
  return prefix;
}

function seqKind(fileName: string): "paren" | "image_num" | "two_digit" | null {
  if (/^.+\(\d+\)\.[^.]+$/i.test(fileName)) return "paren";
  if (/^image[_\-]?\d+\.[^.]+$/i.test(fileName)) return "image_num";
  if (/^\d{2}\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(fileName)) {
    return "two_digit";
  }
  return null;
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
 * 폴더 내 연속 패턴 ≥ SEQUENCE_MIN_COUNT → 해당 파일 경로 집합.
 * KEEP 된 행은 호출 전에 걸러둔다.
 */
export function sequenceExcludePaths(
  rows: Array<{ fullPath: string; path: string; fileName: string }>
): Map<string, string> {
  /** fullPath → reason id */
  const out = new Map<string, string>();

  type Group = { paths: string[]; reason: string };
  const groups = new Map<string, Group>();

  const bump = (key: string, reason: string, fullPath: string) => {
    const g = groups.get(key) ?? { paths: [], reason };
    g.paths.push(fullPath);
    groups.set(key, g);
  };

  for (const row of rows) {
    const folder = folderKeyFromRelativePath(row.path);

    const kind = seqKind(row.fileName);
    if (kind) {
      bump(`${folder}\0kind:${kind}`, `seq_${kind}`, row.fullPath);
    }

    const pref = sequencePrefix(row.fileName);
    if (pref) {
      bump(`${folder}\0pref:${pref}`, "seq_prefix", row.fullPath);
    }

    if (
      CAMERA_ORIGIN_PATH_RE.test(row.path) &&
      CAMERA_FILENAME_RE.test(row.fileName)
    ) {
      const cam =
        row.fileName.match(/^(DSC_?|_JW_|_MG_|IMG_?|DSC)/i)?.[1]?.toLowerCase() ??
        "cam";
      bump(`${folder}\0cam:${cam}`, "seq_camera_origin", row.fullPath);
    }
  }

  for (const g of groups.values()) {
    if (g.paths.length < SEQUENCE_MIN_COUNT) continue;
    for (const p of g.paths) {
      if (!out.has(p)) out.set(p, g.reason);
    }
  }
  return out;
}

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

/**
 * 단일 파일 판정 (연속 규칙은 2차 패스).
 * KEEP 이면 soft 제외만 건너뛰고, 하드(캐시·프레임·3D폴더)는 항상 적용.
 */
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
  const keep = matchKeepPath(rel);

  // 하드 경로 제외 — KEEP이어도
  const ex = matchesExclude(rel);
  if (ex) {
    if (!keep || HARD_EXCLUDE_FOLDER_IDS.has(ex.id)) {
      return { ok: false, reason: `exclude:${ex.id}` };
    }
  }

  const asset = matchAssetFolderExclude(rel);
  if (asset) return { ok: false, reason: `exclude:${asset}` };

  const fn = matchFilenameExclude(fileName);
  if (fn) {
    if (!keep || HARD_EXCLUDE_FILENAME_IDS.has(fn.id)) {
      return { ok: false, reason: `exclude:${fn.id}` };
    }
  }

  if (isVideoCaptureFilename(fileName)) {
    return { ok: false, reason: "exclude:video_capture_name" };
  }

  const tag = matchPriorityFolder(rel) ?? "all";
  if (keep) {
    return { ok: true, includeRule: tag, kept: keep.id };
  }
  return { ok: true, includeRule: tag };
}

export function classifyMediaFile(
  fullPath: string,
  sizeBytes: number
): ClassifyResult {
  return classifyMediaFileBase(fullPath, sizeBytes);
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
    const p = raw
      .replace(/\//g, "\\")
      .replace(/^([A-Za-z]:\\)/, "")
      .toLowerCase();
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

/** walk 중 디렉터리 prune 사유. null 이면 들어감. */
function pruneReason(fullPath: string): string | null {
  const rel = pathForRules(fullPath);
  if (!rel) return null;
  const ex = matchesExclude(rel);
  if (ex && HARD_EXCLUDE_FOLDER_IDS.has(ex.id)) return ex.id;
  const asset = matchAssetFolderExclude(rel);
  if (asset) return asset;
  if (matchKeepPath(rel)) return null;
  if (ex) return ex.id;
  if (/\\#recycle|\\\$recycle|_d5c|\\temp\\|\\tmp\\/i.test(fullPath)) {
    return "recycle_temp";
  }
  return null;
}

/**
 * prune 된 트리는 후보에 안 넣되, ≥100KB 이미지는 사유별로 센다.
 * (예전엔 continue 만 해서 excluded 가 0으로 보였다)
 */
function countPrunedImages(
  dir: string,
  reason: string,
  excluded: Record<string, number>
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const key = `exclude:${reason}`;
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        countPrunedImages(full, reason, excluded);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(name).slice(1).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      if (st.size < MIN_FILE_BYTES) continue;
      excluded[key] = (excluded[key] ?? 0) + 1;
    } catch {
      /* */
    }
  }
}

function walkDir(
  dir: string,
  out: string[],
  excluded: Record<string, number>,
  depth = 0
): void {
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
        const reason = pruneReason(full);
        if (reason) {
          countPrunedImages(full, reason, excluded);
          continue;
        }
        walkDir(full, out, excluded, depth + 1);
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

function buildBigFolders(
  candidates: ScanCandidate[]
): ScanStats["bigFolders"] {
  const map = new Map<string, { count: number; samples: string[] }>();
  for (const c of candidates) {
    const folder = dirname(c.path).replace(/\//g, "\\");
    const row = map.get(folder) ?? { count: 0, samples: [] };
    row.count += 1;
    if (row.samples.length < 3) row.samples.push(c.fileName);
    map.set(folder, row);
  }
  return [...map.entries()]
    .filter(([, v]) => v.count >= NEW_CHUNK_FOLDER_MIN)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 40)
    .map(([folder, v]) => ({
      folder,
      count: v.count,
      samples: v.samples
    }));
}

export function collectMediaCandidates(
  root: string | string[],
  opts?: CollectMediaOpts
): ScanStats {
  const roots = Array.isArray(root) ? root : [root];
  const allFiles: string[] = [];
  const excluded: Record<string, number> = {};
  if (opts?.pilotOnly) {
    const folders = opts.pilotFolders ?? PILOT_PROJECT_FOLDERS_LEGACY;
    const base = roots[0] ?? DEFAULT_SCAN_ROOT;
    for (const name of folders) {
      walkDir(join(base, name), allFiles, excluded);
    }
  } else {
    for (const r of roots) {
      walkDir(r, allFiles, excluded);
    }
  }

  const stats: ScanStats = {
    candidates: [],
    excluded,
    kept: {},
    byProject: {},
    byIncludeRule: {},
    byPriority: {},
    totalFilesSeen: allFiles.length,
    bigFolders: []
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
    if (verdict.kept) {
      stats.kept[verdict.kept] = (stats.kept[verdict.kept] ?? 0) + 1;
    }
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
      ),
      keptBy: verdict.kept
    });
  }

  const nonKept = preCandidates.filter((r) => !r.keptBy);
  const sequencePaths = videoCaptureSequencePaths(preCandidates); // 하드 — KEEP 포함
  const seqAll = sequenceExcludePaths(preCandidates);
  const seqNonKept = sequenceExcludePaths(nonKept);
  const dupPaths = duplicatePathSet(preCandidates);

  for (const row of preCandidates) {
    if (sequencePaths.has(row.fullPath)) {
      stats.excluded["exclude:video_capture_seq"] =
        (stats.excluded["exclude:video_capture_seq"] ?? 0) + 1;
      continue;
    }

    const seqReason = seqAll.get(row.fullPath);
    const softReason = seqNonKept.get(row.fullPath);

    // 현장답사만 연속 규칙 전부 면제. 그 외 KEEP도 접두사·괄호·순번 연속 제외.
    const fieldKeep = row.keptBy === "field_survey";

    if (!fieldKeep && seqReason) {
      stats.excluded[`exclude:${seqReason}`] =
        (stats.excluded[`exclude:${seqReason}`] ?? 0) + 1;
      continue;
    }

    if (!row.keptBy && softReason) {
      stats.excluded[`exclude:${softReason}`] =
        (stats.excluded[`exclude:${softReason}`] ?? 0) + 1;
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

  stats.bigFolders = buildBigFolders(stats.candidates);

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

  console.log("\n--- KEEP (예외로 남김) ---");
  for (const [k, v] of Object.entries(stats.kept).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v.toLocaleString("ko-KR")}장`);
  }
  const anamorphic = stats.candidates.filter((c) =>
    /아나모픽\s*콘텐츠/.test(c.path)
  ).length;
  console.log(
    `\n--- 아나모픽 레퍼런스 잔류 --- ${anamorphic.toLocaleString("ko-KR")}장`
  );

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

  if (stats.bigFolders.length > 0) {
    console.log(`\n--- 폴더 ${NEW_CHUNK_FOLDER_MIN}장+ (상위) ---`);
    for (const f of stats.bigFolders.slice(0, 10)) {
      console.log(
        `  ${f.count.toLocaleString("ko-KR")} · ${f.folder} · ${f.samples.join(", ")}`
      );
    }
  }

  const visionSec = 4.6;
  const totalSec = n * visionSec;
  const hours = totalSec / 3600;
  const visionUsdPerImage = 0.0057;
  const estUsd = n * visionUsdPerImage;

  console.log("\n--- 추정 (참고) ---");
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
        excluded: stats.excluded,
        kept: stats.kept,
        big_folders: stats.bigFolders
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

export {
  DEFAULT_SCAN_ROOT as DEFAULT_PILOT_ROOT,
  DEFAULT_SCAN_ROOT,
  DEFAULT_SCAN_ROOTS
};
