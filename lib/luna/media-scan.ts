import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  DEFAULT_PILOT_ROOT,
  EXCLUDE_FOLDER_PATTERNS,
  FULL_INCLUDE_PATH_PREFIXES,
  IMAGE_EXTENSIONS,
  INCLUDE_FOLDER_PATTERNS,
  MIN_FILE_BYTES,
  PILOT_PROJECT_FOLDERS
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
};

export type ScanStats = {
  candidates: ScanCandidate[];
  excluded: Record<string, number>;
  byProject: Record<string, number>;
  byIncludeRule: Record<string, number>;
  totalFilesSeen: number;
};

function pathForRules(fullPath: string): string {
  const { relativePath } = splitDrivePath(fullPath);
  return normalizeWorkPath(relativePath);
}

/** Ref image 는 capture 제외 규칙보다 살린다 */
function matchesExclude(relPath: string): { id: string } | null {
  for (const row of EXCLUDE_FOLDER_PATTERNS) {
    if (row.id === "capture" && /ref\s*image/i.test(relPath)) continue;
    if (row.re.test(relPath)) return { id: row.id };
  }
  return null;
}

function matchesInclude(relPath: string): string | null {
  for (const prefix of FULL_INCLUDE_PATH_PREFIXES) {
    if (relPath.toLowerCase().startsWith(prefix.toLowerCase())) {
      return "full_tree";
    }
  }
  for (const row of INCLUDE_FOLDER_PATTERNS) {
    if (row.re.test(relPath)) return row.id;
  }
  return null;
}

export function classifyMediaFile(
  fullPath: string,
  sizeBytes: number
): ClassifyResult {
  const ext = extname(fullPath).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "ext" };
  }
  if (sizeBytes < MIN_FILE_BYTES) {
    return { ok: false, reason: "size" };
  }

  const rel = pathForRules(fullPath);
  const ex = matchesExclude(rel);
  if (ex) return { ok: false, reason: `exclude:${ex.id}` };

  const inc = matchesInclude(rel);
  if (!inc) return { ok: false, reason: "no_include" };

  return { ok: true, includeRule: inc };
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

function resolvePilotRoots(root: string): string[] {
  return PILOT_PROJECT_FOLDERS.map((name) => join(root, name));
}

function walkDir(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        walkDir(full, out);
      } else if (st.isFile()) {
        out.push(full);
      }
    } catch {
      /* permission */
    }
  }
}

export function collectMediaCandidates(root: string): ScanStats {
  const pilotRoots = resolvePilotRoots(root);
  const allFiles: string[] = [];
  for (const r of pilotRoots) {
    walkDir(r, allFiles);
  }

  const stats: ScanStats = {
    candidates: [],
    excluded: {},
    byProject: {},
    byIncludeRule: {},
    totalFilesSeen: allFiles.length
  };

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

    const verdict = classifyMediaFile(fullPath, sizeBytes);
    if (!verdict.ok) {
      stats.excluded[verdict.reason] = (stats.excluded[verdict.reason] ?? 0) + 1;
      continue;
    }

    const { drive, relativePath } = splitDrivePath(fullPath);
    const projectFolder = projectFromPath(relativePath);
    const row: ScanCandidate = {
      fullPath,
      drive,
      path: relativePath,
      fileName: basename(fullPath),
      sizeBytes,
      mtimeMs,
      includeRule: verdict.includeRule,
      projectFolder
    };
    stats.candidates.push(row);

    const pk = projectFolder ?? "(unknown)";
    stats.byProject[pk] = (stats.byProject[pk] ?? 0) + 1;
    stats.byIncludeRule[verdict.includeRule] =
      (stats.byIncludeRule[verdict.includeRule] ?? 0) + 1;
  }

  return stats;
}

/** dry-run 후 보고 — 프로젝트별·규칙별·제외 사유별 집계 + 비용·시간 추정 */
export function printMediaDryRunReport(stats: ScanStats, root: string): void {
  const n = stats.candidates.length;
  console.log("\n=== LUNA media index dry-run ===");
  console.log(`root: ${root}`);
  console.log(`파일 열람: ${stats.totalFilesSeen.toLocaleString("ko-KR")}`);
  console.log(`색인 대상: ${n.toLocaleString("ko-KR")}장\n`);

  console.log("--- 프로젝트별 ---");
  for (const [proj, cnt] of Object.entries(stats.byProject).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${proj}: ${cnt.toLocaleString("ko-KR")}장`);
  }

  console.log("\n--- 포함 규칙별 ---");
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

  const visionSec = 12;
  const totalSec = n * visionSec;
  const hours = totalSec / 3600;
  const visionUsdPerImage = 0.02;
  const embedUsdPerImage = 0.00002;
  const estUsd = n * (visionUsdPerImage + embedUsdPerImage);

  console.log("\n--- 추정 (승인 전 참고) ---");
  console.log(
    `  시간: 약 ${hours.toFixed(1)}시간 (장당 ~${visionSec}초, 순차 처리 가정)`
  );
  console.log(
    `  비용: 약 $${estUsd.toFixed(2)} (비전 ~$${visionUsdPerImage}/장 + 임베딩)`
  );
  console.log("  ※ 실제는 네트워크·모델·PSD/AI 처리에 따라 달라집니다.\n");
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

export { DEFAULT_PILOT_ROOT };
