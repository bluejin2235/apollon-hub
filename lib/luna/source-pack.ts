import type { NotionSource } from "@/lib/luna/notion";
import {
  normalizeNasDriveLetter,
  normalizeRawNasPath
} from "@/lib/luna/nas-path";
import type { LunaCard } from "@/lib/luna/tavily";

/** 표시용 — 원본 테이블은 건드리지 않는다 */
export type SourcePackFile = {
  name: string;
  fullPath: string;
  drive: string;
  rawPath: string;
};

export type SourcePackItem = {
  id: string;
  title: string;
  subtitle: string;
  badge: string | null;
  body: string | null;
  onlySide: "notion" | "nas" | null;
  notion: { title: string; url: string; id: string } | null;
  files: SourcePackFile[];
  filesMore: number;
  folder: { label: string; fullPath: string; drive: string; rawPath: string } | null;
  parentId: string | null;
  pathTitles: string[];
  dateKey: number;
  /** 추천·계층 정렬용 (하이브리드 fused/10 또는 임베딩 유사도) */
  score: number;
  /** 화면 표시용 — 있으면 임베딩 유사도, 없으면 score */
  displayScore?: number;
};

export type SourcePackProject = {
  kind: "project";
  id: string;
  title: string;
  subtitle: string;
  badge: string | null;
  notion: { title: string; url: string; id: string } | null;
  folder: SourcePackItem["folder"];
  children: SourcePackItem[];
  score: number;
};

export type SourcePackView =
  | ({ kind: "item" } & SourcePackItem)
  | SourcePackProject;

const MAX_FILES_SHOWN = 3;
const PROJECT_MIN_CHILDREN = 3;

/** 표시 계층 임계값 — 청크 임베딩 실측 분포 기준 (관련 ~0.44–0.54) */
export const PACK_SCORE_RECOMMENDED = 0.42;
export const PACK_SCORE_MID = 0.33;
/** LLM 프롬프트용 기본 상한(단순 조회). 종합·목록은 question-depth 한도를 넘긴다. */
/** LLM 프롬프트용 기본 상한(단순 조회). 종합·목록은 question-depth 한도를 넘긴다. */
export const PACK_LLM_TOP_N = 3;

export function normalizeWorkPath(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+/g, "\\")
    .replace(/\\+$/g, "")
    .trim()
    .toLowerCase();
}

export function fullPathFromParts(drive: string | undefined, rawPath: string): string {
  const letter = normalizeNasDriveLetter(drive) || "T";
  const raw = normalizeRawNasPath(rawPath);
  if (!raw) return `${letter}:`;
  return `${letter}:\\${raw}`;
}

function nasCardFullPath(card: LunaCard): string | null {
  let raw = card.raw_path?.trim() || "";
  if (!raw) {
    let desc = card.description ?? "";
    if (desc.startsWith("★ ")) desc = desc.slice(2);
    raw = desc.split(" · ")[0]?.trim() || "";
  }
  if (!raw) return null;
  // raw may already include drive
  if (/^[TP]:\\/i.test(raw)) return normalizeWorkPath(raw) ? raw.replace(/\//g, "\\") : raw;
  return fullPathFromParts(card.drive, raw);
}

function notionPath(source: NotionSource): string | null {
  const p = (source.nas_path || source.paths?.[0] || "").trim();
  return p ? p.replace(/\//g, "\\").replace(/\\+$/g, "") : null;
}

function isFileCard(card: LunaCard): boolean {
  if (card.is_file === true) return true;
  if (card.is_file === false) return false;
  const name = card.title || card.raw_path || "";
  return /\.[a-z0-9]{1,8}$/i.test(name.split("\\").pop() || name);
}

function folderOfFullPath(full: string, isFile: boolean): string {
  const n = full.replace(/\\+$/g, "");
  if (!isFile) return n;
  const idx = n.lastIndexOf("\\");
  return idx >= 0 ? n.slice(0, idx) : n;
}

function fileNameOf(full: string): string {
  const parts = full.replace(/\\+$/g, "").split("\\");
  return parts[parts.length - 1] || full;
}

function driveAndRaw(full: string): { drive: string; rawPath: string } {
  const m = full.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return { drive: "T", rawPath: normalizeRawNasPath(full) };
  return { drive: m[1]!.toUpperCase(), rawPath: normalizeRawNasPath(m[2] || "") };
}

/** 경로가 같거나, work가 notion 폴더 아래(파일·하위)일 때 */
export function pathMatchesNotion(notionPathStr: string, workFullPath: string, isFile: boolean): boolean {
  const n = normalizeWorkPath(notionPathStr);
  const w = normalizeWorkPath(workFullPath);
  if (!n || !w) return false;
  if (w === n) return true;
  if (isFile) {
    const folder = normalizeWorkPath(folderOfFullPath(workFullPath, true));
    return folder === n || w.startsWith(n + "\\");
  }
  // 폴더: 노션 경로와 같거나 그 하위만. 상위 폴더는 제외
  if (n.startsWith(w + "\\")) return false;
  return w.startsWith(n + "\\") || w === n;
}

function normalizeTitleTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[_\-/[\]()（）·.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= 2);
}

const TITLE_STOP = new Set([
  "fin",
  "final",
  "팀",
  "1팀",
  "2팀",
  "3팀",
  "ppt",
  "pdf",
  "pptx",
  "docx",
  "xlsx"
]);

/** 제목·파일명 상당 부분 겹침 */
export function significantTitleOverlap(a: string, b: string): boolean {
  const ta = normalizeTitleTokens(a);
  const tb = normalizeTitleTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  if (shared.length === 0) return false;
  const joinedA = ta.join(" ");
  const joinedB = tb.join(" ");
  if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) {
    return Math.min(joinedA.length, joinedB.length) >= 8;
  }
  const hasDate = shared.some((t) => /^\d{6}$/.test(t));
  const meaningful = shared.filter(
    (t) => !/^\d{6}$/.test(t) && !TITLE_STOP.has(t)
  );
  if (hasDate && meaningful.length >= 1) return true;
  return meaningful.length >= 3;
}

export function parseTitleDateLabel(title: string): string | null {
  const t = title.trim();
  const m8 = t.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m8) {
    const y = Number(m8[1]);
    const m = Number(m8[2]);
    const d = Number(m8[3]);
    if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  // YYMMDD — 업무 문서 관례상 YY 20~30 만 신뢰 (그 외는 표시하지 않음)
  // 예: 050422 → 애매(2005로 오인) → null / 250422 → 2025.04.22
  const m6 = t.match(/^(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m6) {
    const yy = Number(m6[1]);
    const m = Number(m6[2]);
    const d = Number(m6[3]);
    if (yy < 20 || yy > 30) return null;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = 2000 + yy;
      return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/** 정렬용 — YYYYMMDD 숫자. 파싱 실패 시 0 */
export function notionDateKey(title: string): number {
  const label = parseTitleDateLabel(title);
  if (!label) return 0;
  const digits = label.replace(/\./g, "");
  return Number(digits) || 0;
}

function formatDateLabel(source: NotionSource): string | null {
  const fromTitle = parseTitleDateLabel(source.title);
  if (fromTitle) return fromTitle;
  if (source.last_edited_time) {
    const d = new Date(source.last_edited_time);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}.${m}.${day}`;
    }
  }
  return null;
}

function pathBreadcrumb(pathTitles: string[] | undefined, title: string): string {
  const path = (pathTitles ?? []).filter(Boolean);
  if (path.length >= 2) {
    return `${path[path.length - 2]} › ${path[path.length - 1]}`;
  }
  if (path.length === 1) return path[0]!;
  return title;
}

function badgeFromPath(pathTitles: string[] | undefined): string | null {
  const path = pathTitles ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    const t = path[i]!;
    if (/완료/.test(t)) return "완료";
    if (/진행/.test(t)) return "진행 중";
    if (/^\d{4}/.test(t) && /사업|프로젝트/.test(t)) return t.slice(0, 12);
  }
  if (path.length >= 2) return path[0]!.slice(0, 16);
  return null;
}

function bodyFromNotion(source: NotionSource): string | null {
  const raw = (source.excerpt || source.section || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.slice(0, 220);
}

function toPackFile(full: string): SourcePackFile {
  const { drive, rawPath } = driveAndRaw(full);
  return {
    name: fileNameOf(full),
    fullPath: full.replace(/\//g, "\\"),
    drive,
    rawPath
  };
}

function toFolder(full: string): SourcePackItem["folder"] {
  const cleaned = full.replace(/\\+$/g, "").replace(/\//g, "\\");
  const { drive, rawPath } = driveAndRaw(cleaned);
  return {
    label: cleaned,
    fullPath: cleaned,
    drive,
    rawPath
  };
}

type NasEntry = {
  card: LunaCard;
  full: string;
  norm: string;
  isFile: boolean;
  used: boolean;
};

function buildNasEntries(cards: LunaCard[]): NasEntry[] {
  const out: NasEntry[] = [];
  for (const card of cards) {
    if (card.type !== "nas") continue;
    const full = nasCardFullPath(card);
    if (!full) continue;
    out.push({
      card,
      full: full.replace(/\//g, "\\"),
      norm: normalizeWorkPath(full),
      isFile: isFileCard(card),
      used: false
    });
  }
  return out;
}

function packFromNotion(
  source: NotionSource,
  matched: NasEntry[]
): SourcePackItem {
  const nPath = notionPath(source);
  const files = matched
    .filter((m) => m.isFile)
    .map((m) => toPackFile(m.full));
  const shown = files.slice(0, MAX_FILES_SHOWN);
  const folderFull =
    nPath ||
    matched.find((m) => !m.isFile)?.full ||
    (files[0] ? folderOfFullPath(files[0].fullPath, true) : null);

  const hasNasPath = Boolean(nPath);
  const unmatched = matched.length === 0 && files.length === 0;
  // nas_path 자체가 없을 때만 「폴더 없음」. 경로는 있는데 못 묶였으면 경로만 보여 주고 경고 없음.
  const onlySide: SourcePackItem["onlySide"] =
    unmatched && !hasNasPath ? "notion" : null;

  const date = formatDateLabel(source);
  const crumb = pathBreadcrumb(source.path_titles, source.title);
  const sideLabel = onlySide === "notion" ? "노션에만 있음" : crumb;
  const subtitleParts = [date, sideLabel].filter(Boolean);

  return {
    id: source.id || source.url,
    title: source.title,
    subtitle: subtitleParts.join(" · "),
    badge: badgeFromPath(source.path_titles),
    body: bodyFromNotion(source),
    onlySide,
    notion: { title: source.title, url: source.url, id: source.id },
    files: shown,
    filesMore: Math.max(0, files.length - shown.length),
    folder: folderFull ? toFolder(folderFull) : null,
    parentId: source.parent_id ?? null,
    pathTitles: source.path_titles ?? [],
    dateKey: notionDateKey(source.title),
    score:
      typeof source.match_score === "number"
        ? source.match_score / 10
        : typeof source.similarity === "number"
          ? source.similarity
          : 0,
    // 화면용 — 임베딩 유사도만 (0~1). fused/keyword 점수는 넣지 않는다.
    displayScore:
      typeof source.similarity === "number" && Number.isFinite(source.similarity)
        ? Math.min(1, Math.max(0, source.similarity))
        : undefined
  };
}

function packFromNasOnly(
  entry: NasEntry,
  rank: number,
  /** 노션 히트가 없을 때만 추천(≥PACK_SCORE_RECOMMENDED) 가능 */
  allowRecommend: boolean
): SourcePackItem {
  const title = entry.isFile
    ? entry.card.title || fileNameOf(entry.full)
    : entry.card.title || fileNameOf(entry.full);
  const folderFull = folderOfFullPath(entry.full, entry.isFile);
  const important = entry.card.description?.startsWith("★ ") === true;
  const score = allowRecommend
    ? Math.max(0.35, (important ? 0.82 : 0.78) - rank * 0.1)
    : Math.max(0.35, 0.48 - rank * 0.03);
  const crumb = folderFull
    .replace(/^[A-Za-z]:\\/, "")
    .split("\\")
    .filter(Boolean)
    .slice(-2)
    .join(" › ");
  return {
    id: `nas:${entry.norm}`,
    title,
    subtitle: crumb || "Work서버",
    badge: null,
    body: null,
    onlySide: "nas",
    notion: null,
    files: entry.isFile ? [toPackFile(entry.full)] : [],
    filesMore: 0,
    folder: toFolder(folderFull),
    parentId: null,
    pathTitles: [],
    dateKey: notionDateKey(title),
    score,
    displayScore: Math.min(1, Math.max(0, score))
  };
}

/**
 * 노션·Work서버 결과를 표시용 자료 카드로 묶는다. (원본 데이터 불변)
 */
export function buildSourcePacks(
  notionSources: NotionSource[] | null | undefined,
  cards: LunaCard[] | null | undefined
): SourcePackView[] {
  const notions = (notionSources ?? []).filter((s) => s.title && s.url);
  const nasEntries = buildNasEntries(cards ?? []);
  const notionNormPaths = notions
    .map((s) => notionPath(s))
    .filter((p): p is string => Boolean(p))
    .map(normalizeWorkPath);

  const items: SourcePackItem[] = [];

  for (const source of notions) {
    const nPath = notionPath(source);
    const matched: NasEntry[] = [];

    for (const entry of nasEntries) {
      if (entry.used) continue;
      let hit = false;
      if (nPath && pathMatchesNotion(nPath, entry.full, entry.isFile)) {
        hit = true;
      } else if (
        nPath &&
        entry.isFile &&
        significantTitleOverlap(
          source.title,
          entry.card.title || fileNameOf(entry.full)
        ) &&
        // 폴더가 완전히 다르면 제목만으로 묶지 않음 (같은 잎 폴더 이름만 허용)
        normalizeWorkPath(folderOfFullPath(entry.full, true)).endsWith(
          normalizeWorkPath(nPath).split("\\").pop() || "___"
        )
      ) {
        hit = true;
      }
      // nas_path 없는 노션은 Work와 묶지 않음
      if (hit) {
        entry.used = true;
        matched.push(entry);
      }
    }

    items.push(packFromNotion(source, matched));
  }

  const allowNasRecommend = notions.length === 0;
  let nasOnlyRank = 0;
  for (const entry of nasEntries) {
    if (entry.used) continue;
    // 상위 폴더(노션 경로의 조상)는 따로 보여주지 않음
    if (
      !entry.isFile &&
      notionNormPaths.some((np) => np.startsWith(entry.norm + "\\"))
    ) {
      entry.used = true;
      continue;
    }
    items.push(packFromNasOnly(entry, nasOnlyRank, allowNasRecommend));
    nasOnlyRank += 1;
  }

  return groupPacksIntoProjects(items, notions);
}

function groupPacksIntoProjects(
  items: SourcePackItem[],
  notions: NotionSource[]
): SourcePackView[] {
  const byParent = new Map<string, SourcePackItem[]>();
  const noParent: SourcePackItem[] = [];

  for (const item of items) {
    if (item.parentId) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    } else {
      noParent.push(item);
    }
  }

  const views: SourcePackView[] = [];
  const consumed = new Set<string>();

  for (const [parentId, group] of byParent) {
    const parentSelf = group.find((c) => c.id === parentId);
    const children = group
      .filter((c) => c.id !== parentId)
      .sort(
        (a, b) => a.dateKey - b.dateKey || a.title.localeCompare(b.title, "ko")
      );

    if (children.length >= PROJECT_MIN_CHILDREN) {
      const parentNotion = notions.find((n) => n.id === parentId);
      const sample = children[0]!;
      const parentTitle = (
        parentNotion?.title ||
        parentSelf?.title ||
        sample.pathTitles[sample.pathTitles.length - 2] ||
        sample.title
      )
        .replace(/\(EB 완료\)|\(TJ완료\)/g, "")
        .trim();
      const parentPath = parentNotion ? notionPath(parentNotion) : null;

      for (const m of children) consumed.add(m.id);
      if (parentSelf) consumed.add(parentSelf.id);

      views.push({
        kind: "project",
        id: `project:${parentId}`,
        title: parentTitle,
        subtitle: `${badgeFromPath(sample.pathTitles) || "프로젝트"} · 자료 ${children.length}건`,
        badge: badgeFromPath(parentNotion?.path_titles ?? sample.pathTitles),
        notion: parentNotion
          ? {
              title: parentNotion.title,
              url: parentNotion.url,
              id: parentNotion.id
            }
          : parentSelf?.notion ?? null,
        folder: parentPath
          ? toFolder(parentPath)
          : parentSelf?.folder ??
            children.find((m) => m.folder)?.folder ??
            null,
        children,
        score: Math.max(...children.map((c) => c.score), parentSelf?.score ?? 0)
      });
      continue;
    }

    for (const c of group) {
      views.push({ kind: "item", ...c });
      consumed.add(c.id);
    }
  }

  for (const s of noParent) {
    if (!consumed.has(s.id)) views.push({ kind: "item", ...s });
  }

  return views;
}

/** 배지용 — 묶인 자료 개수 (프로젝트는 자식 수) */
export function countSourcePackMaterials(views: SourcePackView[]): number {
  let n = 0;
  for (const v of views) {
    if (v.kind === "project") n += v.children.length;
    else n += 1;
  }
  return n;
}

export function countSourcePackMaterialsFromMeta(
  notionSources: NotionSource[] | null | undefined,
  cards: LunaCard[] | null | undefined
): number {
  const hasNotion = (notionSources?.length ?? 0) > 0;
  const hasNas = (cards ?? []).some((c) => c.type === "nas");
  if (!hasNotion && !hasNas) return 0;
  return countSourcePackMaterials(buildSourcePacks(notionSources, cards));
}

export type SourcePackTiers = {
  recommended: SourcePackItem | null;
  mid: SourcePackItem[];
  weak: SourcePackItem[];
  maxScore: number;
  lowConfidence: boolean;
};

function viewToDisplayItem(view: SourcePackView): SourcePackItem {
  if (view.kind === "item") return view;
  const hasNotion =
    Boolean(view.notion) || view.children.some((c) => Boolean(c.notion));
  const hasWork =
    Boolean(view.folder) ||
    view.children.some((c) => c.files.length > 0 || Boolean(c.folder));
  const onlySide: SourcePackItem["onlySide"] =
    hasNotion && !hasWork ? "notion" : !hasNotion && hasWork ? "nas" : null;
  // 프로젝트 카드에도 자식 중 노션 링크 하나 노출
  const notion =
    view.notion ??
    view.children.find((c) => c.notion)?.notion ??
    null;
  return {
    id: view.id,
    title: view.title,
    subtitle: view.subtitle,
    badge: view.badge,
    body: null,
    onlySide,
    notion,
    files: [],
    filesMore: 0,
    folder: view.folder,
    parentId: null,
    pathTitles: [],
    dateKey: notionDateKey(view.title),
    score: view.score,
    displayScore: (() => {
      let max: number | undefined;
      for (const c of view.children) {
        if (typeof c.displayScore === "number") {
          max =
            max === undefined
              ? c.displayScore
              : Math.max(max, c.displayScore);
        }
      }
      return max;
    })()
  };
}

/** 정확도 순 세 층 — 추천은 개별 카드(리프) 기준, 프로젝트 묶음은 간략·약함 후보 */
export function tierSourcePacks(views: SourcePackView[]): SourcePackTiers {
  const leaves: SourcePackItem[] = [];
  const projects: SourcePackItem[] = [];
  for (const v of views) {
    if (v.kind === "item") leaves.push(v);
    else {
      leaves.push(...v.children);
      projects.push(viewToDisplayItem(v));
    }
  }

  const byScore = (a: SourcePackItem, b: SourcePackItem) =>
    b.score - a.score || a.title.localeCompare(b.title, "ko");
  leaves.sort(byScore);
  projects.sort(byScore);

  const maxScore = [...leaves, ...projects].reduce(
    (m, x) => Math.max(m, x.score),
    0
  );
  const lowConfidence = maxScore < PACK_SCORE_MID;

  if (leaves.length === 0 && projects.length === 0) {
    return {
      recommended: null,
      mid: [],
      weak: [],
      maxScore: 0,
      lowConfidence: true
    };
  }

  if (lowConfidence) {
    const flat = [...leaves, ...projects].sort(byScore);
    return {
      recommended: null,
      mid: flat.slice(0, 2),
      weak: flat.slice(2),
      maxScore,
      lowConfidence: true
    };
  }

  let recommended: SourcePackItem | null = null;
  for (const item of leaves) {
    if (item.score >= PACK_SCORE_RECOMMENDED) {
      recommended = item;
      break;
    }
  }

  const used = new Set<string>();
  if (recommended) used.add(recommended.id);

  const mid: SourcePackItem[] = [];
  const weak: SourcePackItem[] = [];
  const rest = [...leaves, ...projects]
    .filter((item) => !used.has(item.id))
    .sort(byScore);

  for (const item of rest) {
    if (used.has(item.id)) continue;
    // 추천으로 쓴 리프의 부모 프로젝트는 중복 노출하지 않음
    if (
      recommended &&
      item.id.startsWith("project:") &&
      recommended.parentId &&
      item.id === `project:${recommended.parentId}`
    ) {
      used.add(item.id);
      continue;
    }
    if (
      mid.length < 2 &&
      item.score >= PACK_SCORE_MID
    ) {
      mid.push(item);
      used.add(item.id);
      continue;
    }
    weak.push(item);
    used.add(item.id);
  }

  return { recommended, mid, weak, maxScore, lowConfidence: false };
}

/** LLM 프롬프트용 — 하이브리드 합산(없으면 유사도) 상위 N건 */
export function takeTopNotionSourcesForLlm(
  sources: NotionSource[] | null | undefined,
  n = PACK_LLM_TOP_N
): NotionSource[] {
  const list = [...(sources ?? [])];
  const rank = (s: NotionSource) =>
    typeof s.match_score === "number"
      ? s.match_score
      : (s.similarity ?? 0) * 10;
  list.sort((a, b) => rank(b) - rank(a));
  return list.slice(0, n);
}

export function maxNotionSimilarity(
  sources: NotionSource[] | null | undefined
): number {
  let max = 0;
  for (const s of sources ?? []) {
    if (typeof s.similarity === "number" && s.similarity > max) {
      max = s.similarity;
    }
  }
  return max;
}

/** 재검색·키워드 LLM 스킵 판정 — 임베딩 또는 하이브리드 합산(÷10) 중 큰 값 */
export function maxNotionMatchStrength(
  sources: NotionSource[] | null | undefined
): number {
  let max = 0;
  for (const s of sources ?? []) {
    if (typeof s.similarity === "number" && s.similarity > max) {
      max = s.similarity;
    }
    if (typeof s.match_score === "number") {
      const n = s.match_score / 10;
      if (n > max) max = n;
    }
  }
  return max;
}
