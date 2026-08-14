import type { LunaCard } from "@/lib/luna/tavily";

export type LunaNasDriveMode = "office" | "raidrive";

export const NAS_DRIVE_MODE_STORAGE_KEY = "luna:nas-drive-mode";

export type WorkserverPathGroup = {
  drive: string;
  folderRawPath: string;
  files: string[];
};

/** T:\ 또는 P:\ 로 시작하는 Work서버 경로 */
export const WORKSERVER_OFFICE_PATH_RE = /(?:T|P):\\[^\s\r\n<>|`[\]）)]+/gi;

export function loadNasDriveMode(): LunaNasDriveMode {
  if (typeof window === "undefined") return "office";
  try {
    const v = localStorage.getItem(NAS_DRIVE_MODE_STORAGE_KEY);
    if (v === "raidrive" || v === "office") return v;
  } catch {
    /* ignore */
  }
  return "office";
}

export function saveNasDriveMode(mode: LunaNasDriveMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NAS_DRIVE_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function normalizeNasDriveLetter(drive?: string): string {
  return (drive ?? "").trim().replace(/:$/, "").toUpperCase();
}

export function nasDrivePrefix(
  drive: string | undefined,
  mode: LunaNasDriveMode
): string {
  const letter = normalizeNasDriveLetter(drive);
  if (mode === "raidrive") {
    if (letter === "P") return "Z:\\Partners\\";
    return "Z:\\Work\\";
  }
  if (letter === "P") return "P:\\";
  if (letter === "T") return "T:\\";
  return letter ? `${letter}:\\` : "";
}

export function normalizeRawNasPath(rawPath: string): string {
  return rawPath.replace(/\//g, "\\").replace(/^\\+/, "").replace(/\\+$/, "");
}

/** 표시·복사 공통: 접두사 + 폴더 경로 + 끝 백슬래시 (파일명이면 제거) */
export function formatNasFolderPath(
  drive: string | undefined,
  rawPath: string,
  mode: LunaNasDriveMode,
  isFile: boolean
): string {
  let path = normalizeRawNasPath(rawPath);
  if (!path) {
    const prefix = nasDrivePrefix(drive, mode);
    return prefix.endsWith("\\") ? prefix : prefix ? `${prefix}\\` : "";
  }
  if (isFile) {
    const idx = path.lastIndexOf("\\");
    path = idx >= 0 ? path.slice(0, idx) : "";
  }
  const prefix = nasDrivePrefix(drive, mode);
  if (!path) return prefix.endsWith("\\") ? prefix : prefix ? `${prefix}\\` : "";
  return `${prefix}${path}\\`;
}

export function formatNasFilePath(
  drive: string | undefined,
  rawPath: string,
  mode: LunaNasDriveMode,
  fileName: string
): string {
  const folder = formatNasFolderPath(drive, rawPath, mode, false);
  return `${folder}${fileName}`;
}

export type ParsedOfficePath = {
  drive: string;
  rawPath: string;
  folderRawPath: string;
  fileName: string | null;
  isFile: boolean;
};

export function cleanPathMatch(raw: string): string {
  return raw.replace(/[.,;:!?)>\]"'」】]+$/u, "").trim();
}

export function parseOfficePath(text: string): ParsedOfficePath | null {
  const cleaned = cleanPathMatch(text.trim());
  const m = cleaned.match(/^([TP]):\\(.+)$/i);
  if (!m?.[1] || !m[2]) return null;

  const drive = m[1].toUpperCase();
  const rest = normalizeRawNasPath(m[2]);
  if (!rest) return null;

  const lastSeg = rest.split("\\").pop() ?? "";
  const isFile = /\.[a-z0-9]{1,8}$/i.test(lastSeg);

  if (isFile) {
    const idx = rest.lastIndexOf("\\");
    const folderRawPath = idx >= 0 ? rest.slice(0, idx) : "";
    const fileName = idx >= 0 ? rest.slice(idx + 1) : rest;
    return { drive, rawPath: rest, folderRawPath, fileName, isFile: true };
  }

  return { drive, rawPath: rest, folderRawPath: rest, fileName: null, isFile: false };
}

export function pathGroupKey(drive: string, folderRawPath: string): string {
  return `${drive}::${folderRawPath}`;
}

export function mergePathGroups(
  groups: WorkserverPathGroup[]
): WorkserverPathGroup[] {
  const map = new Map<string, WorkserverPathGroup>();
  for (const g of groups) {
    const key = pathGroupKey(g.drive, g.folderRawPath);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...g, files: [...g.files] });
      continue;
    }
    for (const f of g.files) {
      if (!existing.files.includes(f)) existing.files.push(f);
    }
  }
  return Array.from(map.values());
}

export function pathGroupFromOfficePath(path: string): WorkserverPathGroup | null {
  const parsed = parseOfficePath(path);
  if (!parsed) return null;
  return {
    drive: parsed.drive,
    folderRawPath: parsed.folderRawPath,
    files: parsed.isFile && parsed.fileName ? [parsed.fileName] : []
  };
}

export function pathGroupFromNasCard(card: LunaCard): WorkserverPathGroup | null {
  let rawPath = card.raw_path?.trim() || "";
  if (!rawPath) {
    let desc = card.description ?? "";
    if (desc.startsWith("★ ")) desc = desc.slice(2);
    rawPath = desc.split(" · ")[0]?.trim() || "";
  }
  if (!rawPath) return null;

  rawPath = normalizeRawNasPath(rawPath);
  const drive = normalizeNasDriveLetter(card.drive) || "T";
  const isFile =
    card.is_file === true ||
    (card.is_file !== false &&
      /\.[a-z0-9]{1,8}$/i.test(rawPath.split("\\").pop() || ""));

  if (isFile) {
    const idx = rawPath.lastIndexOf("\\");
    const folderRawPath = idx >= 0 ? rawPath.slice(0, idx) : "";
    const fileName = idx >= 0 ? rawPath.slice(idx + 1) : rawPath;
    return { drive, folderRawPath, files: [fileName] };
  }

  return { drive, folderRawPath: rawPath, files: [] };
}

export function groupNasCardsByFolder(cards: LunaCard[]): WorkserverPathGroup[] {
  const groups: WorkserverPathGroup[] = [];
  for (const card of cards) {
    const g = pathGroupFromNasCard(card);
    if (g) groups.push(g);
  }
  return mergePathGroups(groups);
}

export type MarkdownSegment =
  | { type: "text"; value: string }
  | { type: "paths"; groups: WorkserverPathGroup[] };

const PATH_RUN_GAP_RE = /^[\s,;·\-*•]*$/;

/** 마크다운 본문에서 Work서버 경로 블록을 분리한다 */
export function splitMarkdownByWorkserverPaths(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const re = new RegExp(WORKSERVER_OFFICE_PATH_RE.source, "gi");

  let lastIndex = 0;
  let pathBuffer: string[] = [];
  let match: RegExpExecArray | null;

  const flushPaths = () => {
    if (pathBuffer.length === 0) return;
    segments.push({
      type: "paths",
      groups: mergePathGroups(
        pathBuffer
          .map(pathGroupFromOfficePath)
          .filter((g): g is WorkserverPathGroup => g != null)
      )
    });
    pathBuffer = [];
  };

  while ((match = re.exec(content)) !== null) {
    const between = content.slice(lastIndex, match.index);
    const path = cleanPathMatch(match[0]);

    if (pathBuffer.length > 0 && PATH_RUN_GAP_RE.test(between)) {
      pathBuffer.push(path);
    } else {
      flushPaths();
      if (between) segments.push({ type: "text", value: between });
      pathBuffer = [path];
    }

    lastIndex = match.index + match[0].length;
  }

  flushPaths();
  const tail = content.slice(lastIndex);
  if (tail) segments.push({ type: "text", value: tail });

  if (segments.length === 0) segments.push({ type: "text", value: content });
  return segments;
}
