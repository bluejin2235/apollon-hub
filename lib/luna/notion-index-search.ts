import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueryEmbedding, embeddingToSql } from "@/lib/luna/embedding";
import {
  annotateNotionSourcesWithWorkStage,
  capNotionDisplaySources,
  extractDatesFromText,
  extractWorkserverPathsFromText,
  fetchNotionPagesLive,
  INDEX_DISPLAY_LIMIT,
  mergeNotionSearchOutcomes,
  searchNotionPages,
  type NotionSearchOutcome,
  type NotionSource
} from "@/lib/luna/notion";
import { matchNamedEntities, NAMED_ENTITY_SEED } from "@/lib/luna/named-entities";
import {
  applyPerspectivesToSources,
  annotateSeedsWithProjectKeys,
  expandSourcesViaLinks,
  mergeExpandedSources,
  summarizeProjectGroups
} from "@/lib/luna/search-secondary";
import {
  matchNotionChunksByKeyword,
  mergeNotionHybridChunkHits,
  pickLightKeywords,
  planNotionSearchKeywords,
  type NotionHybridChunkHit
} from "@/lib/luna/notion-keyword";
import {
  loadQueryExpandGlossary,
  type QueryExpandGlossaryRow
} from "@/lib/luna/query-expand";
import {
  RERANK_CANDIDATE_N,
  isRerankConfigured,
  rerankPassages
} from "@/lib/luna/rerank";

/** ì¬ì©ì ì§ì  â ì²­í¬ ë¶í¬ì ë§ì¶¤ (ë¸ë¡ ìì  0.35) */
export const NOTION_INDEX_MATCH_THRESHOLD = 0.3;
export const NOTION_INDEX_TOP_BLOCKS = 12;
export const NOTION_INDEX_MAX_BLOCKS_PER_PAGE = 3;
/** ëª©ë¡í: ì¬ë¬ íë¡ì í¸ê° ê³¨ê³ ë£¨ ë¤ì´ê°ëë¡ íì´ì§ë¹ 1 Â· ìì 20 */
export const NOTION_LISTING_TOP_CHUNKS = 20;
export const NOTION_LISTING_MAX_PER_PAGE = 1;
const MATCH_OVERFETCH = 50;
const LISTING_MATCH_OVERFETCH = 60;
/** ìì¸ íì´ì§ê° ì´ë³´ë¤ ì ì¼ë©´ ì¤ìê° Notion API ë³´ê° */
const LIVE_IF_PAGES_BELOW = 3;
const RECENT_EDIT_MS = 2 * 60 * 60 * 1000;

export type NotionChunkMatchHit = {
  chunk_id: string;
  page_id: string;
  similarity: number;
  keyword_score?: number;
  embedding_score?: number;
  fused_score?: number;
  match_via?: NotionSource["match_via"];
};

type IndexedPageRow = {
  page_id: string;
  title: string;
  parent_id: string | null;
  path_titles: string[] | null;
  nas_path: string | null;
  url: string | null;
  last_edited_time: string | null;
};

type IndexedChunkRow = {
  chunk_id: string;
  page_id: string;
  heading: string;
  text: string;
  position: number;
};

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("Could not find the function") ||
    msg.includes("does not exist")
  );
}

function asPathTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

function isRecentEdit(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now - t <= RECENT_EDIT_MS;
}

export async function matchNotionChunkEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<NotionChunkMatchHit[] | null> {
  const { data, error } = await admin.rpc("luna_match_notion_chunks", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? NOTION_INDEX_MATCH_THRESHOLD,
    match_count: opts?.limit ?? MATCH_OVERFETCH
  });
  if (error) {
    if (!isMissingRpc(error)) {
      console.error("[luna/notion-index] chunk match rpc", error);
    }
    return null;
  }
  return (data ?? [])
    .map((row: Record<string, unknown>) => ({
      chunk_id: String(row.chunk_id ?? ""),
      page_id: String(row.page_id ?? ""),
      similarity: Number(row.similarity) || 0
    }))
    .filter(
      (r: NotionChunkMatchHit) =>
        r.chunk_id && r.page_id && r.similarity >= NOTION_INDEX_MATCH_THRESHOLD
    );
}

/** í©ì° ì ì ì ì ì§, íì´ì§ë¹ ìµë 3ì²­í¬, ìì 12.
 * ì ëª© í¤ìë ê°íí¸(â¥ TITLE)ë ìë² ë©ë§ ìë íë³´ë³´ë¤ ë¨¼ì  ë£ëë¤.
 */
export function selectNotionChunkHits(
  hits: NotionChunkMatchHit[],
  opts?: { top?: number; perPage?: number }
): NotionChunkMatchHit[] {
  const top = opts?.top ?? NOTION_INDEX_TOP_BLOCKS;
  const perPage = opts?.perPage ?? NOTION_INDEX_MAX_BLOCKS_PER_PAGE;
  const rank = (h: NotionChunkMatchHit) =>
    h.fused_score ?? h.similarity ?? 0;
  const sorted = [...hits].sort((a, b) => rank(b) - rank(a));
  const titleStrong = sorted.filter(
    (h) => (h.keyword_score ?? 0) >= 4
  );
  const rest = sorted.filter((h) => (h.keyword_score ?? 0) < 4);
  const ordered = [...titleStrong, ...rest];
  const perPageCount = new Map<string, number>();
  const out: NotionChunkMatchHit[] = [];
  for (const hit of ordered) {
    const n = perPageCount.get(hit.page_id) ?? 0;
    if (n >= perPage) continue;
    perPageCount.set(hit.page_id, n + 1);
    out.push(hit);
    if (out.length >= top) break;
  }
  return out;
}

function hybridToChunkHits(hits: NotionHybridChunkHit[]): NotionChunkMatchHit[] {
  return hits.map((h) => ({
    chunk_id: h.chunk_id,
    page_id: h.page_id,
    similarity: h.similarity,
    keyword_score: h.keyword_score,
    embedding_score: h.embedding_score,
    fused_score: h.fused_score,
    match_via: h.match_via
  }));
}

/** fused 상위 N을 BGE 리랭크로 재정렬. 설정·본문 없으면 입력 그대로. */
async function rerankHybridChunkHits(
  admin: SupabaseClient,
  queryText: string,
  hits: NotionChunkMatchHit[],
  limit = RERANK_CANDIDATE_N
): Promise<{ hits: NotionChunkMatchHit[]; rerank_ms: number; used: boolean }> {
  if (!queryText.trim() || hits.length < 2 || !isRerankConfigured()) {
    return { hits, rerank_ms: 0, used: false };
  }
  const rank = (h: NotionChunkMatchHit) => h.fused_score ?? h.similarity ?? 0;
  const candidates = [...hits].sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  const rest = hits.filter((h) => !candidates.some((c) => c.chunk_id === h.chunk_id));
  const ids = candidates.map((h) => h.chunk_id).filter(Boolean);
  if (ids.length < 2) return { hits, rerank_ms: 0, used: false };

  const { data, error } = await admin
    .from("luna_notion_chunks")
    .select("chunk_id, heading, text")
    .in("chunk_id", ids);
  if (error) {
    console.error("[luna/notion-index] rerank chunks", error);
    return { hits, rerank_ms: 0, used: false };
  }
  const textById = new Map<string, string>();
  for (const row of data ?? []) {
    const id = String((row as { chunk_id?: string }).chunk_id ?? "");
    const heading = String((row as { heading?: string }).heading ?? "").trim();
    const text = String((row as { text?: string }).text ?? "").trim();
    if (!id) continue;
    textById.set(id, [heading, text].filter(Boolean).join("\n").slice(0, 1200));
  }
  const passages = candidates
    .map((h) => ({
      id: h.chunk_id,
      text: textById.get(h.chunk_id) ?? ""
    }))
    .filter((p) => p.text.length > 0);
  if (passages.length < 2) return { hits, rerank_ms: 0, used: false };

  const result = await rerankPassages({ query: queryText, passages });
  if (!result.used) {
    return { hits, rerank_ms: result.ms, used: false };
  }
  const byId = new Map(candidates.map((h) => [h.chunk_id, h]));
  const maxFused = Math.max(...candidates.map((h) => rank(h)), 1);
  const reranked: NotionChunkMatchHit[] = [];
  for (let i = 0; i < result.orderedIds.length; i += 1) {
    const id = result.orderedIds[i]!;
    const hit = byId.get(id);
    if (!hit) continue;
    const score = result.scores[i] ?? 0;
    // 하위 selectNotionChunkHits 가 fused 를 쓰므로 리랭크 순서를 점수에 반영
    const fused = maxFused + (result.orderedIds.length - i);
    reranked.push({
      ...hit,
      fused_score: fused,
      similarity: Number.isFinite(score) ? score : hit.similarity
    });
  }
  return {
    hits: [...reranked, ...rest],
    rerank_ms: result.ms,
    used: true
  };
}

function formatHierarchy(opts: {
  page: IndexedPageRow;
  siblings: IndexedPageRow[];
  queryText?: string;
}): string {
  const path = asPathTitles(opts.page.path_titles);
  const parentTitle =
    path.length >= 2 ? path[path.length - 2]! : path[0] ?? opts.page.title;
  const selfTitle = opts.page.title.trim();
  const lines = [`ê³ì¸µ: ${parentTitle}`];

  const terms = (opts.queryText ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const scored = opts.siblings
    .map((s) => {
      const title = s.title.trim();
      if (!title) return null;
      const lower = title.toLowerCase();
      let score = 0;
      if (s.page_id === opts.page.page_id) score += 100;
      for (const t of terms) {
        if (lower.includes(t)) score += 10;
      }
      if (/ideation|ìì´ë°ì´ì|ì ì|concept|ì»¨ì/i.test(title)) score += 2;
      return { title, page_id: s.page_id, score };
    })
    .filter((x): x is { title: string; page_id: string; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ko"));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const key = row.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row.title);
    if (unique.length >= 12) break;
  }
  if (unique.length === 0 && selfTitle) unique.push(selfTitle);

  unique.forEach((t, i) => {
    const branch = i === unique.length - 1 ? "â" : "â";
    lines.push(`  ${branch} ${t}`);
  });
  if (path.length > 0) {
    lines.push(`ê²½ë¡: ${path.join(" âº ")}`);
  }
  return lines.join("\n");
}

function pageChunksToSource(
  page: IndexedPageRow,
  chunks: IndexedChunkRow[],
  siblings: IndexedPageRow[],
  similarity: number,
  queryText?: string,
  hybrid?: {
    keyword_score?: number;
    embedding_score?: number;
    match_score?: number;
    match_via?: NotionSource["match_via"];
  }
): NotionSource {
  const sorted = chunks.slice().sort((a, b) => a.position - b.position);
  const body = sorted
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const hierarchy = formatHierarchy({ page, siblings, queryText });
  const section =
    sorted.find((c) => c.heading.trim())?.heading.trim().slice(0, 80) ??
    sorted[0]?.text.replace(/\s+/g, " ").trim().slice(0, 80) ??
    "";
  const hay = `${page.title}\n${body}\n${hierarchy}`;
  const paths = [
    ...(page.nas_path ? [page.nas_path] : []),
    ...extractWorkserverPathsFromText(hay)
  ];
  const pathSeen = new Set<string>();
  const uniquePaths = paths.filter((p) => {
    const key = p.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || pathSeen.has(key)) return false;
    pathSeen.add(key);
    return true;
  });
  const dates = extractDatesFromText(hay);
  const entities = matchNamedEntities(hay, NAMED_ENTITY_SEED)
    .filter((e) => e.kind !== "brand_group")
    .map((e) => e.canonical);

  return {
    title: page.title || "(ì ëª© ìì)",
    url: page.url || `https://notion.so/${page.page_id.replace(/-/g, "")}`,
    id: page.page_id,
    last_edited_time: page.last_edited_time,
    excerpt: body.replace(/\s+/g, " ").trim().slice(0, 280) || null,
    paths: uniquePaths,
    dates,
    entities,
    section: section || null,
    hierarchy,
    nas_path: page.nas_path,
    similarity,
    keyword_score: hybrid?.keyword_score,
    embedding_score: hybrid?.embedding_score,
    match_score: hybrid?.match_score,
    match_via: hybrid?.match_via,
    parent_id: page.parent_id,
    path_titles: asPathTitles(page.path_titles)
  };
}

async function buildIndexedSourcesFromChunks(
  admin: SupabaseClient,
  hits: NotionChunkMatchHit[],
  queryText?: string,
  pickOpts?: { top?: number; perPage?: number }
): Promise<{
  sources: NotionSource[];
  pages: IndexedPageRow[];
  selectedHits: NotionChunkMatchHit[];
}> {
  const selectedHits = selectNotionChunkHits(hits, pickOpts);
  if (selectedHits.length === 0) {
    return { sources: [], pages: [], selectedHits: [] };
  }

  const chunkIds = selectedHits.map((h) => h.chunk_id);
  const pageIds = [...new Set(selectedHits.map((h) => h.page_id))];

  const [{ data: chunkRows, error: chunkErr }, { data: pageRows, error: pageErr }] =
    await Promise.all([
      admin
        .from("luna_notion_chunks")
        .select("chunk_id, page_id, heading, text, position")
        .in("chunk_id", chunkIds),
      admin
        .from("luna_notion_pages")
        .select(
          "page_id, title, parent_id, path_titles, nas_path, url, last_edited_time"
        )
        .in("page_id", pageIds)
    ]);

  if (chunkErr) console.error("[luna/notion-index] chunks", chunkErr);
  if (pageErr) console.error("[luna/notion-index] pages", pageErr);

  const chunks = (chunkRows ?? []) as IndexedChunkRow[];
  const pages = (pageRows ?? []).map((p) => ({
    ...(p as IndexedPageRow),
    path_titles: asPathTitles((p as IndexedPageRow).path_titles)
  }));

  const parentIds = [
    ...new Set(pages.map((p) => p.parent_id).filter((id): id is string => Boolean(id)))
  ];
  let siblings: IndexedPageRow[] = [];
  if (parentIds.length > 0) {
    const { data: sibRows, error: sibErr } = await admin
      .from("luna_notion_pages")
      .select(
        "page_id, title, parent_id, path_titles, nas_path, url, last_edited_time"
      )
      .in("parent_id", parentIds)
      .eq("archived", false)
      .limit(120);
    if (sibErr) console.error("[luna/notion-index] siblings", sibErr);
    siblings = ((sibRows ?? []) as IndexedPageRow[]).map((p) => ({
      ...p,
      path_titles: asPathTitles(p.path_titles)
    }));
  }

  const pageById = new Map(pages.map((p) => [p.page_id, p]));
  const chunksByPage = new Map<string, IndexedChunkRow[]>();
  const simByPage = new Map<string, number>();
  const kwByPage = new Map<string, number>();
  const embScoreByPage = new Map<string, number>();
  const fusedByPage = new Map<string, number>();
  const viaByPage = new Map<string, NotionSource["match_via"]>();
  const hitOrder = new Map(selectedHits.map((h, i) => [h.chunk_id, i]));

  for (const c of chunks) {
    const list = chunksByPage.get(c.page_id) ?? [];
    list.push(c);
    chunksByPage.set(c.page_id, list);
  }
  for (const h of selectedHits) {
    const prev = simByPage.get(h.page_id) ?? 0;
    if (h.similarity > prev) simByPage.set(h.page_id, h.similarity);
    const kw = h.keyword_score ?? 0;
    if (kw > (kwByPage.get(h.page_id) ?? 0)) kwByPage.set(h.page_id, kw);
    const emb = h.embedding_score ?? (h.similarity > 0 ? h.similarity * 10 : 0);
    if (emb > (embScoreByPage.get(h.page_id) ?? 0)) {
      embScoreByPage.set(h.page_id, emb);
    }
    const fused = h.fused_score ?? kw + emb;
    if (fused > (fusedByPage.get(h.page_id) ?? 0)) {
      fusedByPage.set(h.page_id, fused);
      viaByPage.set(h.page_id, h.match_via);
    }
  }

  for (const [, list] of chunksByPage) {
    list.sort(
      (a, b) => (hitOrder.get(a.chunk_id) ?? 999) - (hitOrder.get(b.chunk_id) ?? 999)
    );
  }

  const sources: NotionSource[] = [];
  for (const pageId of pageIds) {
    const page = pageById.get(pageId);
    const pageChunks = chunksByPage.get(pageId) ?? [];
    if (!page || pageChunks.length === 0) continue;
    const sibs = siblings.filter(
      (s) => s.parent_id && s.parent_id === page.parent_id
    );
    sources.push(
      pageChunksToSource(
        page,
        pageChunks,
        sibs.length > 0 ? sibs : [page],
        simByPage.get(pageId) ?? 0,
        queryText,
        {
          keyword_score: kwByPage.get(pageId),
          embedding_score: embScoreByPage.get(pageId),
          match_score: fusedByPage.get(pageId),
          match_via: viaByPage.get(pageId)
        }
      )
    );
  }

  sources.sort(
    (a, b) =>
      (b.match_score ?? b.similarity ?? 0) - (a.match_score ?? a.similarity ?? 0)
  );
  const byTitle = new Map<string, NotionSource>();
  for (const s of sources) {
    const key = s.title.toLowerCase().replace(/\s+/g, " ").trim();
    const prev = byTitle.get(key);
    if (!prev) {
      byTitle.set(key, s);
      continue;
    }
    const prevScore =
      (prev.match_score ?? (prev.similarity ?? 0) * 10) +
      (prev.nas_path || (prev.paths?.length ?? 0) > 0 ? 1 : 0);
    const nextScore =
      (s.match_score ?? (s.similarity ?? 0) * 10) +
      (s.nas_path || (s.paths?.length ?? 0) > 0 ? 1 : 0);
    if (nextScore > prevScore) byTitle.set(key, s);
  }
  return {
    sources: capNotionDisplaySources([...byTitle.values()], INDEX_DISPLAY_LIMIT),
    pages,
    selectedHits
  };
}

/**
 * ìì¸ ì°ì  ë¸ì ê²ì.
 * - ìë² ë© â luna_match_notion_chunks â ì²­í¬ ë³¸ë¬¸Â·ê³ì¸µ
 * - íì´ì§ 3ê±´ ë¯¸ë§ì´ë©´ ì¤ìê° Notion API ë³´ê°
 * - ìµê·¼ 2ìê° ìì  íì´ì§ë§ ì¤ìê° ë³¸ë¬¸ ì¬ì¡°í
 */
export async function searchNotionForLuna(
  admin: SupabaseClient,
  keywords: string,
  queryContext?: string,
  opts?: {
    queryEmbedding?: number[] | null;
    /** ëª©ë¡í ë± â ì¤ìê° Notion API ë ëê³  ìì¸ë§ */
    skipLive?: boolean;
    /** ëª©ë¡í: ìì 20ì²­í¬ Â· íì´ì§ë¹ 1 */
    listing?: boolean;
    /** 2차 링크·관점 확장 (기본 true) */
    useSecondary?: boolean;
    /** 표기 변형 질의 확장 (기본 true) */
    queryExpand?: boolean;
    glossary?: QueryExpandGlossaryRow[];
  }
): Promise<NotionSearchOutcome> {
  const started = Date.now();
  const queryText = (queryContext?.trim() || keywords).trim();
  const listing = Boolean(opts?.listing);
  const queryExpand = opts?.queryExpand !== false;
  const topN = listing ? NOTION_LISTING_TOP_CHUNKS : NOTION_INDEX_TOP_BLOCKS;
  const perPage = listing
    ? NOTION_LISTING_MAX_PER_PAGE
    : NOTION_INDEX_MAX_BLOCKS_PER_PAGE;
  const overfetch = listing ? LISTING_MATCH_OVERFETCH : MATCH_OVERFETCH;
  let embedding = opts?.queryEmbedding ?? null;
  let embedMs = 0;
  if (!embedding && queryText) {
    // ìì¸ ì ì© ê²½ë¡ â ì§ë¬¸ ìë² ë©ì´ ìì¼ë©´ ì¬ì  ìê² í ë² ìì±
    const embStarted = Date.now();
    embedding = await createQueryEmbedding(queryText, { timeoutMs: 8_000 });
    embedMs = Date.now() - embStarted;
  }

  let indexSources: NotionSource[] = [];
  let selectedHits: NotionChunkMatchHit[] = [];
  let pages: IndexedPageRow[] = [];
  let rpcFailed = false;
  let keywordHitCount = 0;

  const searchStarted = Date.now();
  const glossaryPromise =
    queryExpand && (opts?.glossary?.length ?? 0) === 0
      ? loadQueryExpandGlossary(admin)
      : Promise.resolve(opts?.glossary ?? []);

  // 벡터 먼저 — 키워드와 동시 실행하면 HNSW 캐시를 ILIKE 가 밀어낸다
  // 용어사전 로드는 작은 select 라 벡터와 같이 돌려도 된다
  let chunkHits: Awaited<ReturnType<typeof matchNotionChunkEmbeddings>> = null;
  let glossary: QueryExpandGlossaryRow[] = opts?.glossary ?? [];
  if (embedding) {
    const [hits, gloss] = await Promise.all([
      matchNotionChunkEmbeddings(admin, embedding, {
        threshold: NOTION_INDEX_MATCH_THRESHOLD,
        limit: overfetch
      }),
      glossaryPromise
    ]);
    chunkHits = hits;
    glossary = gloss;
  } else if (queryExpand) {
    glossary = await glossaryPromise;
  }
  if (chunkHits === null && embedding) {
    rpcFailed = true;
  }

  const plan = planNotionSearchKeywords(
    keywords,
    queryText,
    queryExpand ? glossary : []
  );
  const searchKws = plan.keywords;

  const chunkPageCount = new Set((chunkHits ?? []).map((h) => h.page_id)).size;
  const needKeyword =
    !embedding ||
    chunkHits === null ||
    chunkPageCount < LIVE_IF_PAGES_BELOW;

  let keywordHits: Awaited<ReturnType<typeof matchNotionChunksByKeyword>> = [];
  if (needKeyword) {
    keywordHits = await matchNotionChunksByKeyword(admin, searchKws, {
      limit: overfetch,
      extra: queryExpand ? plan.extra : []
    });
  } else if (queryExpand) {
    const lightKws = pickLightKeywords(plan);
    if (lightKws.length > 0) {
      keywordHits = await matchNotionChunksByKeyword(admin, lightKws, {
        limit: overfetch,
        light: true,
        extra: plan.extra
      });
    }
  }
  keywordHitCount = keywordHits.length;

  const hybridHits = mergeNotionHybridChunkHits(chunkHits ?? [], keywordHits);
  let hybridChunkHits = hybridToChunkHits(hybridHits);
  let rerankMs = 0;
  let rerankUsed = false;
  if (hybridChunkHits.length > 0) {
    const reranked = await rerankHybridChunkHits(
      admin,
      queryText,
      hybridChunkHits,
      overfetch
    );
    hybridChunkHits = reranked.hits;
    rerankMs = reranked.rerank_ms;
    rerankUsed = reranked.used;
  }

  if (hybridChunkHits.length > 0) {
    const built = await buildIndexedSourcesFromChunks(
      admin,
      hybridChunkHits,
      queryText,
      { top: topN, perPage }
    );
    indexSources = built.sources;
    selectedHits = built.selectedHits;
    pages = built.pages;
  }

  const pageCount = indexSources.length;
  const recentPages = pages.filter((p) => isRecentEdit(p.last_edited_time));
  // ìì¸ ê²°ê³¼ê° ì ì¼ë©´ ì¤ìê° Notion API ë³´ê°
  const needSparseLive =
    !opts?.skipLive && pageCount < LIVE_IF_PAGES_BELOW;

  let liveOutcome: NotionSearchOutcome = {
    status: "skipped",
    sources: [],
    queries: ["index"],
    rounds: 0
  };

  if (needSparseLive) {
    liveOutcome = await searchNotionPages(keywords, queryContext);
  } else if (!opts?.skipLive && recentPages.length > 0) {
    const refreshed = await fetchNotionPagesLive(
      recentPages.map((p) => ({
        id: p.page_id,
        title: p.title,
        url: p.url || "",
        last_edited_time: p.last_edited_time
      }))
    );
    liveOutcome = {
      status: refreshed.length > 0 ? "ok" : "empty",
      sources: refreshed,
      queries: ["index-recent-refresh"],
      rounds: 1
    };
    // ìì¸ ê²°ê³¼ë¥¼ ìµì  ë³¸ë¬¸ì¼ë¡ êµì²´
    const byId = new Map(refreshed.map((s) => [s.id, s]));
    indexSources = indexSources.map((s) => {
      const live = byId.get(s.id);
      if (!live) return s;
      return {
        ...s,
        excerpt: live.excerpt ?? s.excerpt,
        paths:
          (live.paths?.length ?? 0) > 0
            ? live.paths
            : s.paths,
        dates: live.dates?.length ? live.dates : s.dates,
        last_edited_time: live.last_edited_time ?? s.last_edited_time
      };
    });
  }

  const indexOutcome: NotionSearchOutcome = {
    status: indexSources.length > 0 ? "ok" : "empty",
    sources: indexSources,
    queries: ["index"],
    rounds: 1
  };

  const merged = needSparseLive
    ? mergeNotionSearchOutcomes(indexOutcome, liveOutcome)
    : indexOutcome;

  console.log("[luna/notion-index] search", {
    keywords: keywords.slice(0, 60),
    searchKws: searchKws.slice(0, 12),
    expandExtra: plan.extra.slice(0, 8),
    chunks: selectedHits.length,
    keywordHits: keywordHitCount,
    pages: pageCount,
    listing,
    skipLive: Boolean(opts?.skipLive),
    rpcFailed,
    hybrid: selectedHits.slice(0, 8).map((h) => ({
      page_id: h.page_id.slice(0, 8),
      sim: Number((h.similarity ?? 0).toFixed(3)),
      kw: Number((h.keyword_score ?? 0).toFixed(2)),
      emb: Number((h.embedding_score ?? 0).toFixed(2)),
      fused: Number((h.fused_score ?? h.similarity ?? 0).toFixed(2)),
      via: h.match_via ?? "embedding"
    })),
    sparseLive: needSparseLive,
    recentRefresh: recentPages.length,
    liveSources: liveOutcome.sources.length,
    final: merged.sources.length,
    rerank: rerankUsed ? rerankMs : false,
    ms: Date.now() - started
  });

  const searchMs = Math.max(0, Date.now() - searchStarted - rerankMs);

  const stagedSources = queryText
    ? annotateNotionSourcesWithWorkStage(merged.sources, queryText)
    : merged.sources;

  const useSecondary =
    opts?.useSecondary !== false && !listing;
  let finalSources = stagedSources;
  let secondaryMeta: NotionSearchOutcome["secondary"] = {
    link_added: 0,
    link_ms: 0,
    links_followed: 0,
    perspectives: [],
    perspective_ms: 0,
    project_groups: []
  };
  const candidatesFound = stagedSources.length;

  if (useSecondary && finalSources.length > 0) {
    try {
      const withProjects = await annotateSeedsWithProjectKeys(
        admin,
        finalSources
      );
      const persp = await applyPerspectivesToSources(
        admin,
        queryText || keywords,
        withProjects
      );
      const expanded = await expandSourcesViaLinks(admin, persp.sources, {
        query: queryText || keywords
      });
      finalSources = mergeExpandedSources(persp.sources, expanded.sources);
      if (queryText) {
        finalSources = annotateNotionSourcesWithWorkStage(
          finalSources,
          queryText
        );
      }
      const groups = summarizeProjectGroups(finalSources);
      secondaryMeta = {
        link_added: expanded.stats.added,
        link_ms: expanded.stats.ms,
        links_followed: expanded.stats.links_followed,
        perspectives: persp.stats.names,
        perspective_ms: persp.stats.ms,
        project_groups: groups.map((g) => ({
          title: g.title,
          notion: g.notion,
          meetings: g.meetings,
          ideation: g.ideation,
          proposals: g.proposals,
          work: g.work
        }))
      };
      console.log("[luna/notion-index] secondary", {
        perspectives: secondaryMeta.perspectives,
        link_added: secondaryMeta.link_added,
        link_ms: secondaryMeta.link_ms,
        perspective_ms: secondaryMeta.perspective_ms,
        groups: secondaryMeta.project_groups.length,
        final: finalSources.length
      });
    } catch (err) {
      console.error("[luna/notion-index] secondary failed", err);
    }
  }

  return {
    ...merged,
    sources: finalSources,
    queries: [...new Set([...merged.queries, "index"])],
    secondary: secondaryMeta,
    timings: {
      embed_ms: embedMs,
      search_ms: searchMs,
      rerank_ms: rerankMs,
      candidates_found: candidatesFound
    }
  };
}
