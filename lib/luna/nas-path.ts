import type { LunaCard } from "@/lib/luna/tavily";

export type LunaNasDriveMode = "office" | "raidrive";

export const NAS_DRIVE_MODE_STORAGE_KEY = "luna:nas-drive-mode";

export type WorkserverPathGroup = {
  drive: string;
  folderRawPath: string;
  files: string[];
};

/** @deprecated 스캐너 기반 findAllWorkserverPathSpans 사용 */
export const WORKSERVER_OFFICE_PATH_RE = /(?:T|P):\\[^\r\n`[\]()（）]+/gi;

const FILE_EXT_RE = /\.[a-z0-9]{1,8}$/i;

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

/** 화면용: 드라이브부터 전체를 › 로 구분 (복사 경로는 formatNasFolderPath) */
export function formatNasFolderBreadcrumb(
  drive: string | undefined,
  rawPath: string,
  mode: LunaNasDriveMode
): string {
  const full = formatNasFolderPath(drive, rawPath, mode, false).replace(/\\+$/, "");
  if (!full) return "";
  return full.replace(/\\/g, " › ");
}

export type FileExtBadgeKind =
  | "PPT"
  | "XLS"
  | "PDF"
  | "DOC"
  | "DWG"
  | "IMG"
  | "VID"
  | "FILE";

export function fileExtBadgeKind(fileName: string): FileExtBadgeKind {
  const m = fileName.trim().match(/\.([a-z0-9]{1,8})$/i);
  const ext = (m?.[1] ?? "").toLowerCase();
  if (ext === "ppt" || ext === "pptx") return "PPT";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "XLS";
  if (ext === "pdf") return "PDF";
  if (ext === "doc" || ext === "docx" || ext === "hwp") return "DOC";
  if (ext === "dwg" || ext === "dxf" || ext === "skp" || ext === "3dm") return "DWG";
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "psd" || ext === "ai") {
    return "IMG";
  }
  if (ext === "mp4" || ext === "mov" || ext === "avi") return "VID";
  return "FILE";
}

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,8}$/i, "");
}

export type LunaFileTag = { label: string; kind: "final" | "draft" };

export function inferFileTag(
  fileName: string,
  folderRawPath?: string
): LunaFileTag | null {
  const stem = stripFileExtension(fileName);
  if (/계약용|최종본|_FIN\b|[-_]FIN$/i.test(stem) || /최종/.test(stem)) {
    return { label: "최종", kind: "final" };
  }
  if (/초안|draft/i.test(stem)) {
    return { label: "초안", kind: "draft" };
  }
  const last = (folderRawPath ?? "").split("\\").pop() ?? "";
  if (/초안|제안서/.test(last)) {
    return { label: "초안", kind: "draft" };
  }
  return null;
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

/** 경로 끝의 문장 부호만 제거 (경로 본문은 유지) */
export function cleanPathMatch(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^[`'"]+/, "").replace(/[`'"]+$/, "");
  s = s.replace(/[.,;:!?)>\]"'」】]+$/u, "");
  return s.trim();
}

export function isOfficeDriveAt(content: string, i: number): boolean {
  const a = content.charCodeAt(i);
  const b = content.charCodeAt(i + 1);
  const c = content.charCodeAt(i + 2);
  if (b !== 58 || c !== 92) return false;
  return a === 84 || a === 116 || a === 80 || a === 112;
}

export function parseOfficePath(text: string): ParsedOfficePath | null {
  const cleaned = cleanPathMatch(text.trim());
  if (!isOfficeDriveAt(cleaned, 0)) return null;
  if (cleaned.length < 3) return null;

  const drive = cleaned[0]!.toUpperCase();
  let rest = cleaned.slice(3).replace(/\//g, "\\");
  const hadTrailingSlash = rest.endsWith("\\");
  rest = rest.replace(/\\+$/, "");
  if (!rest && !hadTrailingSlash) return null;

  if (!rest && hadTrailingSlash) {
    return { drive, rawPath: "", folderRawPath: "", fileName: null, isFile: false };
  }

  const lastSeg = rest.split("\\").pop() ?? "";
  const isFile = !hadTrailingSlash && FILE_EXT_RE.test(lastSeg);

  if (isFile) {
    const idx = rest.lastIndexOf("\\");
    const folderRawPath = idx >= 0 ? rest.slice(0, idx) : "";
    const fileName = idx >= 0 ? rest.slice(idx + 1) : rest;
    if (!fileName) return null;
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
      FILE_EXT_RE.test(rawPath.split("\\").pop() || ""));

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

type PathSpan = {
  start: number;
  end: number;
  original: string;
  path: string;
};

function drivePathStart(content: string, from: number): number {
  const last = content.length - 2;
  for (let i = from; i < last; i++) {
    if (isOfficeDriveAt(content, i)) return i;
  }
  return -1;
}

function pathCompleteAtSpace(pathSoFar: string): boolean {
  const trimmed = pathSoFar.trimEnd();
  if (!trimmed) return false;
  const lastSeg = trimmed.split("\\").pop() ?? "";
  if (FILE_EXT_RE.test(lastSeg)) return true;
  if (trimmed.endsWith("\\")) return true;
  return false;
}

function proseAfterSpace(content: string, spaceIndex: number): boolean {
  let j = spaceIndex + 1;
  while (j < content.length && content[j] === " ") j += 1;
  if (j >= content.length) return false;
  const next = content[j];
  if (/[가-힣]/.test(next)) {
    const ahead = content.slice(j, j + 8);
    if (/^\d/.test(ahead.trim())) return false;
    return true;
  }
  return false;
}

/** T:\ / P:\ 부터 줄 끝·백틱·따옴표·닫는 괄호 또는 완성된 경로 뒤 공백까지 스캔 */
export function scanBareOfficePath(
  content: string,
  start: number
): { raw: string; end: number } | null {
  const pathStart = drivePathStart(content, start);
  if (pathStart < 0) return null;

  let i = pathStart + 1;
  if (content[i] !== ":") return null;
  i += 1;
  if (content[i] !== "\\") return null;
  i += 1;

  while (i < content.length) {
    const ch = content[i];
    if (ch === "\r" || ch === "\n" || ch === "`") break;
    if (ch === '"' || ch === "'") break;
    if (ch === ")" || ch === "]" || ch === "）" || ch === "】") break;

    if (ch === " ") {
      const pathSoFar = content.slice(pathStart, i);
      if (pathCompleteAtSpace(pathSoFar) && proseAfterSpace(content, i)) {
        break;
      }
    }
    i += 1;
  }

  let raw = content.slice(pathStart, i);
  raw = cleanPathMatch(raw);
  if (!isOfficeDriveAt(raw, 0)) return null;
  if (!parseOfficePath(raw)) return null;
  return { raw, end: i };
}

/** 인라인 코드·본문에서 Work서버 경로 구간을 찾는다 (겹침 없음) */
export function findAllWorkserverPathSpans(content: string): PathSpan[] {
  const spans: PathSpan[] = [];
  const covered = new Uint8Array(content.length);

  const mark = (start: number, end: number) => {
    for (let i = start; i < end; i++) covered[i] = 1;
  };

  const isFree = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      if (covered[i]) return false;
    }
    return true;
  };

  const pushSpan = (start: number, end: number, path: string) => {
    const cleaned = cleanPathMatch(path);
    if (!parseOfficePath(cleaned)) return;
    const fromBacktick = content[start] === "`";
    spans.push({
      start,
      end,
      original: fromBacktick ? cleaned : content.slice(start, end),
      path: cleaned
    });
    mark(start, end);
  };

  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "`") continue;

    const close = content.indexOf("`", i + 1);
    if (close > i) {
      const inner = content.slice(i + 1, close).trim();
      if (isOfficeDriveAt(inner, 0) && isFree(i, close + 1)) {
        pushSpan(i, close + 1, inner);
      }
      i = close;
      continue;
    }

    const absStart = drivePathStart(content, i + 1);
    if (absStart >= 0) {
      const scanned = scanBareOfficePath(content, absStart);
      if (scanned && isFree(i, scanned.end)) {
        pushSpan(i, scanned.end, scanned.raw);
        i = scanned.end - 1;
      }
    }
  }

  for (let i = 0; i < content.length; i++) {
    if (covered[i]) continue;
    if (!isOfficeDriveAt(content, i)) continue;
    const scanned = scanBareOfficePath(content, i);
    if (!scanned || !isFree(i, scanned.end)) continue;
    pushSpan(i, scanned.end, scanned.raw);
    i = scanned.end - 1;
  }

  spans.sort((a, b) => a.start - b.start);
  return spans;
}

const PATH_RUN_GAP_RE = /^[\s,;·\-*•]*$/;

function unwrapListLine(line: string): string {
  let t = line.trim();
  t = t.replace(/^[-*•]\s+/, "");
  t = t.replace(/^(?:→|->)\s*/, "");
  return t.trim();
}

function isBareFileName(value: string): boolean {
  const t = value.trim();
  if (!t || t.includes("\\") || t.includes("/")) return false;
  return FILE_EXT_RE.test(t);
}

function extractFileNameFromLine(line: string): string | null {
  let t = unwrapListLine(line);
  if (t.startsWith("`") && t.endsWith("`") && t.length > 2) {
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith("**") && t.endsWith("**") && t.length > 4) {
    t = t.slice(2, -2).trim();
  }
  return isBareFileName(t) ? t : null;
}

function extractFolderFromLine(
  line: string
): { raw: string; backtick: boolean } | null {
  let t = unwrapListLine(line);
  const backtick = t.startsWith("`") && t.endsWith("`") && t.length > 2;
  if (backtick) t = t.slice(1, -1).trim();
  if (!isOfficeDriveAt(t, 0)) return null;
  const parsed = parseOfficePath(t);
  if (!parsed || parsed.isFile) return null;
  return { raw: t, backtick };
}

function emitMergedPath(
  folder: { raw: string; backtick: boolean },
  fileName: string
): string {
  const folderClean = folder.raw.replace(/\\+$/, "");
  const merged = `${folderClean}\\${fileName}`;
  return folder.backtick ? `\`${merged}\`` : merged;
}

/**
 * 폴더/파일 줄 조합을 한 경로로 합친다.
 * - `T:\\folder\\` + 다음 줄 `→ file.pptx`
 * - **file.pptx** + 다음 줄 `T:\\folder\\`
 * - 폴더만 단독이면 그대로 둔다 (스캐너가 카드로 만듦)
 */
export function preprocessFolderFileLines(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const fileHere = extractFileNameFromLine(lines[i] ?? "");
    const folderNext =
      i + 1 < lines.length ? extractFolderFromLine(lines[i + 1] ?? "") : null;
    if (fileHere && folderNext) {
      out.push(emitMergedPath(folderNext, fileHere));
      i += 1;
      continue;
    }

    const folderHere = extractFolderFromLine(lines[i] ?? "");
    const fileNext =
      i + 1 < lines.length ? extractFileNameFromLine(lines[i + 1] ?? "") : null;
    if (folderHere && fileNext) {
      out.push(emitMergedPath(folderHere, fileNext));
      i += 1;
      while (i + 1 < lines.length) {
        const more = extractFileNameFromLine(lines[i + 1] ?? "");
        if (!more) break;
        out.push(emitMergedPath(folderHere, more));
        i += 1;
      }
      continue;
    }

    out.push(lines[i] ?? "");
  }

  return out.join("\n");
}

/** 마크down 본문에서 Work서버 경로 블록을 분리한다. 파싱 실패 구간은 원문 유지 */
export function splitMarkdownByWorkserverPaths(content: string): MarkdownSegment[] {
  const normalized = preprocessFolderFileLines(content);
  const spans = findAllWorkserverPathSpans(normalized);
  if (spans.length === 0) {
    return [{ type: "text", value: normalized }];
  }

  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;
  let pathBuffer: PathSpan[] = [];

  const flushPaths = () => {
    if (pathBuffer.length === 0) return;
    const groups = mergePathGroups(
      pathBuffer
        .map((s) => pathGroupFromOfficePath(s.path))
        .filter((g): g is WorkserverPathGroup => g != null)
    );
    if (groups.length > 0) {
      segments.push({ type: "paths", groups });
    } else {
      segments.push({ type: "text", value: pathBuffer.map((s) => s.original).join("") });
    }
    pathBuffer = [];
  };

  for (const span of spans) {
    const between = normalized.slice(lastIndex, span.start);

    if (pathBuffer.length > 0 && PATH_RUN_GAP_RE.test(between)) {
      pathBuffer.push(span);
    } else {
      flushPaths();
      if (between) segments.push({ type: "text", value: between });
      pathBuffer = [span];
    }

    lastIndex = span.end;
  }

  flushPaths();
  const tail = normalized.slice(lastIndex);
  if (tail) segments.push({ type: "text", value: tail });

  if (segments.length === 0) return [{ type: "text", value: normalized }];
  return segments;
}
