import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyNamedEntitiesToTerms,
  loadNamedEntities,
  NAMED_ENTITY_SEED,
  pathVariantsForTerm,
  type NamedEntity
} from "@/lib/luna/named-entities";

export type WorkserverItem = {
  drive: string | null;
  path: string;
  name: string;
  type: string | null;
  importance: number | null;
  file_summary: string | null;
  modified_at: string | null;
  variant_hidden?: number;
};

type NasRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
  importance: number | null;
};

const VARIANT_EXT_RANK: Record<string, number> = {
  pptx: 0,
  ppt: 1,
  docx: 2,
  xlsx: 3,
  hwp: 4,
  pdf: 5
};

const IMG_MARKER_STRIP_RE = /(\(\s*img\s*\)|_img|\(\s*이미지\s*\))/gi;
const IMG_MARKER_TEST_RE = /(\(\s*img\s*\)|_img|\(\s*이미지\s*\))/i;
const MAX_SEARCH_RESULTS = 6;

const NAS_SELECT =
  "drive, path, type, size_bytes, modified_at, file_summary, importance";

function normalizeWsPath(path: string): string {
  return path.replace(/\//g, "\\").replace(/^\\+|\\+$/g, "");
}

function pathName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function toItem(row: NasRow): WorkserverItem {
  return {
    drive: row.drive,
    path: row.path,
    name: pathName(row.path),
    type: row.type,
    importance: row.importance ?? 0,
    file_summary: row.file_summary,
    modified_at: row.modified_at
  };
}

function parentDir(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx).toLowerCase() : "";
}

function exactRowKey(drive: string | null | undefined, path: string): string {
  const d = (drive ?? "").trim().toUpperCase();
  const p = normalizeWsPath(path).toLowerCase();
  return `${d}::${p}`;
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
  const a = ancestor.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const d = descendant.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!a || a === d) return false;
  return d.startsWith(`${a}/`);
}

function fileExtension(name: string): string {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1]!.toLowerCase() : "";
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function hasImgMarker(fileName: string): boolean {
  return IMG_MARKER_TEST_RE.test(stripExtension(fileName));
}

/** 확장자·(img)/_img/(이미지)·끝 공백 제거 후 비교 키 */
function documentVariantKey(path: string): string {
  const base = stripExtension(pathName(path))
    .replace(IMG_MARKER_STRIP_RE, "")
    .replace(/\s+$/g, "");
  return `${parentDir(path)}\0${base.toLowerCase()}`;
}

function variantExtRank(path: string): number {
  const ext = fileExtension(pathName(path));
  return VARIANT_EXT_RANK[ext] ?? 99;
}

function compareDocumentVariants<
  T extends { path: string; modified_at?: string | null }
>(a: T, b: T): number {
  const aImg = hasImgMarker(pathName(a.path)) ? 1 : 0;
  const bImg = hasImgMarker(pathName(b.path)) ? 1 : 0;
  if (aImg !== bImg) return aImg - bImg;

  const aExt = variantExtRank(a.path);
  const bExt = variantExtRank(b.path);
  if (aExt !== bExt) return aExt - bExt;

  const aTime = a.modified_at ? Date.parse(a.modified_at) : 0;
  const bTime = b.modified_at ? Date.parse(b.modified_at) : 0;
  const aOk = Number.isFinite(aTime) ? aTime : 0;
  const bOk = Number.isFinite(bTime) ? bTime : 0;
  return bOk - aOk;
}

/**
 * 같은 문서의 형식 변형(img/확장자)을 하나로 정리.
 * 조상 폴더 dedup 이후에 호출.
 */
export function dedupeDocumentVariants<
  T extends { path: string; modified_at?: string | null }
>(rows: T[]): Array<T & { variant_hidden: number }> {
  const original = rows.length;
  if (original === 0) {
    console.log("[luna/ws] variant dedup", 0, "→", 0);
    return [];
  }

  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = documentVariantKey(row.path);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: Array<T & { variant_hidden: number }> = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(compareDocumentVariants);
    const winner = sorted[0]!;
    result.push({ ...winner, variant_hidden: group.length - 1 });
  }

  console.log("[luna/ws] variant dedup", original, "→", result.length);
  return result;
}

function dedupeExactRows<
  T extends { drive?: string | null; path: string; importance?: number | null }
>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = exactRowKey(row.drive, row.path);
    const prev = map.get(key);
    if (!prev || (row.importance ?? 0) > (prev.importance ?? 0)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function dedupeAncestorFolders<
  T extends { path: string; type?: string | null }
>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const hasFile = rows.some((r) => (r.type ?? "").toLowerCase() === "file");
  if (!hasFile) {
    return [...rows]
      .sort((a, b) => b.path.length - a.path.length)
      .slice(0, 3);
  }
  const sorted = [...rows].sort((a, b) => b.path.length - a.path.length);
  const kept: T[] = [];
  for (const row of sorted) {
    if (kept.some((k) => isAncestorPath(row.path, k.path))) continue;
    kept.push(row);
  }
  return kept;
}

/**
 * 최종 결과 파이프라인 (순서 고정):
 * 합친 결과 → 완전동일 제거 → 조상 폴더 제거 → variant dedup → importance 정렬 → 최대 6건
 */
export function runWorkserverResultPipeline<
  T extends {
    drive?: string | null;
    path: string;
    type?: string | null;
    modified_at?: string | null;
    importance?: number | null;
  }
>(rows: T[]): Array<T & { variant_hidden: number }> {
  const raw = rows.length;
  if (raw === 0) {
    console.log("[luna/ws] pipeline", {
      raw: 0,
      dedupExact: 0,
      dedupAncestor: 0,
      dedupVariant: 0,
      final: 0
    });
    return [];
  }

  const afterExact = dedupeExactRows(rows);
  const afterAncestor = dedupeAncestorFolders(afterExact);
  const afterVariant = dedupeDocumentVariants(afterAncestor);
  const final = [...afterVariant]
    .sort(compareImportanceThenModified)
    .slice(0, MAX_SEARCH_RESULTS);

  console.log("[luna/ws] pipeline", {
    raw,
    dedupExact: afterExact.length,
    dedupAncestor: afterAncestor.length,
    dedupVariant: afterVariant.length,
    final: final.length
  });
  return final;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GENERIC_DOC_TERMS = new Set([
  "수행계획서",
  "보고서",
  "제안서",
  "자료",
  "문서",
  "파일",
  "계획서",
  "소개서",
  "기획서",
  "발표자료",
  "찾아줘",
  "검색"
]);

/** 자연어 질문에서 path 검색에 쓰면 안 되는 조사·요청어 */
const SEARCH_STOP_WORDS = new Set([
  "프로젝트",
  "위치",
  "어디",
  "어디에",
  "어디있",
  "어디있어",
  "어디에있",
  "찾아",
  "찾아줘",
  "찾아주",
  "찾아주세요",
  "알려",
  "알려줘",
  "알려주",
  "알려주세요",
  "있어",
  "있나",
  "있나요",
  "있을까",
  "좀",
  "해줘",
  "해주세요",
  "주세요",
  "원래",
  "질문",
  "확인된",
  "조건",
  "관련",
  "대한",
  "필요",
  "부탁"
]);

const MEDIA_EXTS = new Set([
  "mp4",
  "mov",
  "avi",
  "jpg",
  "jpeg",
  "png",
  "psd",
  "ai"
]);

const MEDIA_QUERY_RE = /영상|비디오|이미지|사진|레퍼런스\s*영상/;

function splitKeywords(keywords: string): string[] {
  return keywords
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

function isSearchableToken(token: string): boolean {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (SEARCH_STOP_WORDS.has(token) || SEARCH_STOP_WORDS.has(lower)) return false;
  if (GENERIC_DOC_TERMS.has(token) || GENERIC_DOC_TERMS.has(lower)) return false;
  if (/^[a-zA-Z]$/.test(token)) return false;
  if (token.length < 2 && !/^\d+$/.test(token)) return false;
  return true;
}

/** LLM/사용자 키워드에서 path AND 검색용 토큰만 추출 (2자 한글 포함) */
export function prepareSearchTerms(
  keywords: string,
  queryContext?: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): string[] {
  const kwTerms = splitKeywords(keywords).filter(isSearchableToken);
  const ctxTerms = splitKeywords(queryContext ?? "").filter(isSearchableToken);
  const merged = [...new Set([...kwTerms, ...ctxTerms])];
  const restricted = applyNamedEntitiesToTerms(merged, queryContext ?? keywords, entities);
  return restricted.filter(isSearchableToken).slice(0, 8);
}

/** 한 토큰에 대한 path 부분일치 패턴 (견적서→견적, 고유명사 별칭) */
function pathMatchVariants(term: string, entities: NamedEntity[] = NAMED_ENTITY_SEED): string[] {
  return pathVariantsForTerm(term, entities);
}

function haystack(row: NasRow): string {
  return `${row.path}\n${row.file_summary ?? ""}`.toLowerCase();
}

function termMatchesHaystack(
  h: string,
  term: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  if (pathMatchVariants(term, entities).some((v) => h.includes(v))) return true;
  const seasonM = term.replace(/\s+/g, "").match(/^시즌(\d+)$/i);
  if (seasonM?.[1]) return pathHasSeason(h, seasonM[1]);
  const sM = term.match(/^s(\d+)$/i);
  if (sM?.[1]) return pathHasSeason(h, sM[1]);
  return false;
}

function matchesAll(
  row: NasRow,
  terms: string[],
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  if (terms.length === 0) return false;
  const h = haystack(row);
  return terms.every((t) => termMatchesHaystack(h, t, entities));
}

function compareImportanceThenModified<
  T extends { importance?: number | null; modified_at?: string | null }
>(a: T, b: T): number {
  const imp = (b.importance ?? 0) - (a.importance ?? 0);
  if (imp !== 0) return imp;
  const aTime = a.modified_at ? Date.parse(a.modified_at) : 0;
  const bTime = b.modified_at ? Date.parse(b.modified_at) : 0;
  const aOk = Number.isFinite(aTime) ? aTime : 0;
  const bOk = Number.isFinite(bTime) ? bTime : 0;
  return bOk - aOk;
}

function rankByImportance(rows: NasRow[]): NasRow[] {
  return [...rows].sort(compareImportanceThenModified);
}

function underBase(row: NasRow, base: string): boolean {
  if (!base) return true;
  return row.path === base || row.path.startsWith(`${base}\\`);
}

/** SQL에서도 AND(ilike 연쇄). OR 완화 없음. */
async function fetchCandidates(
  admin: SupabaseClient,
  opts: {
    terms: string[];
    basePath?: string;
    drive?: string;
    limit: number;
    entities?: NamedEntity[];
  }
): Promise<NasRow[]> {
  let query = admin
    .from("nas_directory")
    .select(NAS_SELECT)
    .order("importance", { ascending: false })
    .limit(opts.limit);

  if (opts.drive) {
    query = query.eq("drive", opts.drive.trim().toUpperCase());
  }

  const base = opts.basePath ? normalizeWsPath(opts.basePath) : "";
  if (base) {
    query = query.gte("path", base).lt("path", `${base}\uFFFF`);
  }

  const entities = opts.entities ?? NAMED_ENTITY_SEED;
  for (const term of opts.terms) {
    const variants = pathMatchVariants(term, entities);
    if (variants.length === 0) continue;
    if (variants.length === 1) {
      query = query.ilike("path", `%${variants[0]}%`);
    } else {
      const orClause = variants.map((v) => `path.ilike.%${v}%`).join(",");
      query = query.or(orClause);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/ws] fetchCandidates", error);
    return [];
  }

  const rows = (data ?? []) as NasRow[];
  if (!base) return rows;
  return rows.filter((r) => underBase(r, base));
}

type SeasonId = { n: string };
type PlainId = { raw: string };

function extractSeasonIds(text: string): SeasonId[] {
  const found = new Map<string, SeasonId>();
  const patterns = [
    /시즌\s*(\d+)/gi,
    /season\s*(\d+)/gi,
    /(?:^|[^A-Za-z0-9])S\s*(\d+)(?![A-Za-z0-9])/gi
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = m[1];
      if (n) found.set(n, { n });
    }
  }
  return Array.from(found.values());
}

function extractPlainIds(text: string): PlainId[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(\d+)\s*차/g)) {
    if (m[0]) found.add(m[0].replace(/\s+/g, ""));
  }
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    if (m[1]) found.add(m[1]);
  }
  for (const m of text.matchAll(/\b(\d{6})\b/g)) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found).map((raw) => ({ raw }));
}

function pathHasSeason(path: string, n: string): boolean {
  const seasonKo = new RegExp(`시즌\\s*${n}(?!\\d)`, "i");
  const seasonEn = new RegExp(`season\\s*${n}(?!\\d)`, "i");
  const seasonS = new RegExp(`(?:^|[^A-Za-z0-9])S\\s*${n}(?![A-Za-z0-9])`, "i");
  return seasonKo.test(path) || seasonEn.test(path) || seasonS.test(path);
}

function filterByIdentifiers<T extends { path: string }>(
  rows: T[],
  queryText: string
): T[] {
  const seasons = extractSeasonIds(queryText);
  const plains = extractPlainIds(queryText);
  if (seasons.length === 0 && plains.length === 0) return rows;

  return rows.filter((row) => {
    for (const s of seasons) {
      if (!pathHasSeason(row.path, s.n)) return false;
    }
    for (const p of plains) {
      if (!row.path.includes(p.raw)) return false;
    }
    return true;
  });
}

function queryWantsMedia(queryText: string): boolean {
  return MEDIA_QUERY_RE.test(queryText);
}

function filterMediaExt<T extends { path: string }>(
  rows: T[],
  queryText: string
): T[] {
  if (queryWantsMedia(queryText)) return rows;
  return rows.filter((row) => {
    const ext = fileExtension(pathName(row.path));
    return !MEDIA_EXTS.has(ext);
  });
}

/** 수집된 Work서버 결과에 시즌·미디어 필터 재적용 */
export function refineWorkserverHits<T extends { path: string }>(
  rows: T[],
  queryText: string
): T[] {
  const q = queryText.trim();
  if (!q) return rows;
  return filterMediaExt(filterByIdentifiers(rows, q), q);
}

function dropOneGeneric(terms: string[]): string[] | null {
  const idx = terms.findIndex((t) => GENERIC_DOC_TERMS.has(t.toLowerCase()) || GENERIC_DOC_TERMS.has(t));
  if (idx < 0) return null;
  return terms.filter((_, i) => i !== idx);
}

function isSeasonLikeToken(t: string): boolean {
  return /^(시즌\s*\d+|season\s*\d+|s\d+|\d+차)$/i.test(t.replace(/\s+/g, " ").trim());
}

function isProjectNameToken(t: string): boolean {
  if (!t || GENERIC_DOC_TERMS.has(t) || GENERIC_DOC_TERMS.has(t.toLowerCase())) {
    return false;
  }
  if (isSeasonLikeToken(t)) return false;
  if (/^\d{4}$/.test(t) || /^\d{6}$/.test(t)) return false;
  if (/^[A-Z][A-Za-z0-9_-]*$/.test(t)) return true;
  if (/^[가-힣]{2,}$/.test(t)) return true;
  return false;
}

function pickProjectName(terms: string[]): string | null {
  const candidates = terms.filter(isProjectNameToken);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.length - a.length)[0] ?? null;
}

async function expandFoldersOneLevel(
  admin: SupabaseClient,
  rows: NasRow[],
  drive?: string
): Promise<NasRow[]> {
  const hasFile = rows.some((r) => (r.type ?? "").toLowerCase() === "file");
  if (hasFile) return rows;

  const folders = rows.filter((r) => (r.type ?? "").toLowerCase() === "folder");
  if (folders.length === 0) return rows;

  const merged = new Map<string, NasRow>();
  for (const row of rows) {
    merged.set(exactRowKey(row.drive, row.path), row);
  }

  for (const folder of folders.slice(0, 2)) {
    const children = await listFolder(
      admin,
      folder.path,
      folder.drive ?? drive
    );
    for (const item of children) {
      const child: NasRow = {
        drive: item.drive,
        path: item.path,
        type: item.type,
        size_bytes: null,
        modified_at: item.modified_at,
        file_summary: item.file_summary,
        importance: item.importance
      };
      merged.set(exactRowKey(child.drive, child.path), child);
    }
  }

  return Array.from(merged.values());
}

async function progressiveAndSearch(
  admin: SupabaseClient,
  keywords: string,
  queryText: string,
  opts: { basePath?: string; drive?: string }
): Promise<NasRow[]> {
  const entities = await loadNamedEntities(admin);
  const terms = prepareSearchTerms(keywords, queryText, entities);
  if (terms.length === 0) {
    console.log("[luna/ws] match", "empty-terms", { keywords, queryText }, "→", 0);
    return [];
  }

  type Stage = { name: string; terms: string[] };
  const stages: Stage[] = [{ name: "and-all", terms }];

  if (terms.length >= 3) {
    const reduced = dropOneGeneric(terms);
    if (reduced && reduced.length > 0 && reduced.length < terms.length) {
      stages.push({ name: "and-drop-generic", terms: reduced });
    }
  }

  const project = pickProjectName(terms);
  if (project && !(terms.length === 1 && terms[0] === project)) {
    stages.push({ name: "and-project", terms: [project] });
  }

  for (const stage of stages) {
    const rows = await fetchCandidates(admin, {
      terms: stage.terms,
      basePath: opts.basePath,
      drive: opts.drive,
      limit: 80,
      entities
    });
    let hits = rows.filter((r) => matchesAll(r, stage.terms, entities));
    hits = filterByIdentifiers(hits, queryText);
    hits = filterMediaExt(hits, queryText);
    if (
      hits.length > 0 &&
      hits.every((r) => (r.type ?? "").toLowerCase() === "folder")
    ) {
      hits = await expandFoldersOneLevel(admin, hits, opts.drive);
      hits = hits.filter((r) => matchesAll(r, stage.terms, entities));
      hits = filterByIdentifiers(hits, queryText);
      hits = filterMediaExt(hits, queryText);
    }
    console.log("[luna/ws] match", stage.name, stage.terms, "→", hits.length);
    if (hits.length > 0) {
      // 상한/variant 는 최종 pipeline 에서 처리 (여기서 자르면 원본이 탈락함)
      return rankByImportance(hits).slice(0, 40);
    }
  }

  console.log("[luna/ws] match", "empty", { keywords, terms, queryText }, "→", 0);
  return [];
}

/** 경로 바로 아래 항목만. path 빈 문자열이면 각 드라이브 최상위. */
export async function listFolder(
  admin: SupabaseClient,
  path: string,
  drive?: string
): Promise<WorkserverItem[]> {
  const base = normalizeWsPath(path || "");
  let query = admin
    .from("nas_directory")
    .select(NAS_SELECT)
    .order("importance", { ascending: false })
    .limit(40);

  if (drive) {
    query = query.eq("drive", drive.trim().toUpperCase());
  }

  if (!base) {
    // 최상위: 경로에 구분자가 없는 항목 (LIKE 미사용 — regex)
    query = query.not("path", "match", "[\\\\/]");
  } else {
    // 한 단계 자식만: ^base\\[^\\]+$
    const pattern = `^${escapeRegExp(base)}\\\\[^\\\\]+$`;
    query = query.filter("path", "match", pattern);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/ws] listFolder", error);
    console.log("[luna/ws]", "listFolder", { path, drive }, "→", 0);
    return [];
  }

  const items = ((data ?? []) as NasRow[]).map(toItem).slice(0, 40);
  console.log("[luna/ws]", "listFolder", { path, drive }, "→", items.length);
  return items;
}

/** basePath 아래에서만 검색. AND만 사용, 품질 우선. */
export async function searchIn(
  admin: SupabaseClient,
  basePath: string,
  keywords: string,
  drive?: string,
  queryContext?: string
): Promise<WorkserverItem[]> {
  const queryText = (queryContext?.trim() || keywords).trim();
  const terms = prepareSearchTerms(keywords, queryText);
  const picked = await progressiveAndSearch(admin, keywords, queryText, {
    basePath,
    drive
  });
  const items = runWorkserverResultPipeline(picked).map(toItem);
  console.log(
    "[luna/ws]",
    "searchIn",
    { basePath, keywords, terms, drive },
    "→",
    items.length
  );
  return items;
}

/** 전체 검색. AND만 사용, 품질 우선. */
export async function searchAll(
  admin: SupabaseClient,
  keywords: string,
  queryContext?: string
): Promise<WorkserverItem[]> {
  const queryText = (queryContext?.trim() || keywords).trim();
  const terms = prepareSearchTerms(keywords, queryText);
  const picked = await progressiveAndSearch(admin, keywords, queryText, {});
  const items = runWorkserverResultPipeline(picked).map(toItem);
  console.log("[luna/ws]", "searchAll", { keywords, terms }, "→", items.length);
  return items;
}

/** 도구 루프 실패 시 fallback — 동일 AND 품질 파이프라인. */
export async function searchNasLegacy(
  admin: SupabaseClient,
  keywords: string,
  queryContext?: string
): Promise<NasRow[]> {
  const queryText = (queryContext?.trim() || keywords).trim();
  const terms = prepareSearchTerms(keywords, queryText);
  if (terms.length === 0) return [];
  const picked = await progressiveAndSearch(admin, keywords, queryText, {});
  const finalized = runWorkserverResultPipeline(picked);
  console.log(
    "[luna/ws]",
    "searchNasLegacy",
    { keywords, terms },
    "→",
    finalized.length
  );
  return finalized;
}

/**
 * 노션에 기록된 nas_path 로 색인을 직접 조회한다.
 * 키워드 검색에 안 잡혀도 경로가 있으면 폴더·하위 파일을 붙인다.
 */
export async function lookupNasByRecordedPaths(
  admin: SupabaseClient,
  recordedPaths: string[]
): Promise<NasRow[]> {
  const out: NasRow[] = [];
  const seen = new Set<string>();

  for (const raw of recordedPaths) {
    const full = raw.trim().replace(/\//g, "\\");
    if (!full) continue;
    const m = full.match(/^([A-Za-z]):\\(.+)$/);
    const drive = (m?.[1] || "T").toUpperCase();
    const path = normalizeWsPath(m ? m[2]! : full.replace(/^[A-Za-z]:\\/, ""));
    if (!path) continue;

    const key = `${drive}:${path}`.toLowerCase();
    if (seen.has(key)) continue;

    const { data: exact, error: exactErr } = await admin
      .from("nas_directory")
      .select(NAS_SELECT)
      .eq("drive", drive)
      .eq("path", path)
      .maybeSingle();
    if (exactErr) {
      console.error("[luna/ws] lookupNas exact", exactErr);
    } else if (exact) {
      const row = exact as NasRow;
      const k = `${row.drive}:${row.path}`.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(row);
      }
    }

    const { data: kids, error: kidsErr } = await admin
      .from("nas_directory")
      .select(NAS_SELECT)
      .eq("drive", drive)
      .gte("path", `${path}\\`)
      .lt("path", `${path}\\\uFFFF`)
      .order("importance", { ascending: false })
      .limit(8);
    if (kidsErr) {
      console.error("[luna/ws] lookupNas kids", kidsErr);
      continue;
    }
    for (const row of (kids ?? []) as NasRow[]) {
      const k = `${row.drive}:${row.path}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }

  console.log("[luna/ws] lookupNasByRecordedPaths", {
    paths: recordedPaths.length,
    hits: out.length
  });
  return out;
}
