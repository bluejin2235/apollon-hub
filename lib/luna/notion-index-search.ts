import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueryEmbedding, embeddingToSql } from "@/lib/luna/embedding";
import {
  capNotionDisplaySources,
  extractDatesFromText,
  extractWorkserverPathsFromText,
  fetchNotionPagesLive,
  mergeNotionSearchOutcomes,
  searchNotionPages,
  type NotionSearchOutcome,
  type NotionSource
} from "@/lib/luna/notion";
import { matchNamedEntities, NAMED_ENTITY_SEED } from "@/lib/luna/named-entities";

/** 사용자 지정 — 바꾸지 말 것 */
export const NOTION_INDEX_MATCH_THRESHOLD = 0.35;
export const NOTION_INDEX_TOP_BLOCKS = 12;
export const NOTION_INDEX_MAX_BLOCKS_PER_PAGE = 3;
const MATCH_OVERFETCH = 36;
const LIVE_IF_PAGES_BELOW = 3;
const RECENT_EDIT_MS = 2 * 60 * 60 * 1000;

export type NotionBlockMatchHit = {
  block_id: string;
  page_id: string;
  similarity: number;
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

type IndexedBlockRow = {
  block_id: string;
  page_id: string;
  block_type: string;
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

/** 유사도 순 유지, 페이지당 최대 3블록, 상위 12블록 */
export function selectNotionBlockHits(
  hits: NotionBlockMatchHit[],
  opts?: { top?: number; perPage?: number }
): NotionBlockMatchHit[] {
  const top = opts?.top ?? NOTION_INDEX_TOP_BLOCKS;
  const perPage = opts?.perPage ?? NOTION_INDEX_MAX_BLOCKS_PER_PAGE;
  const sorted = [...hits].sort((a, b) => b.similarity - a.similarity);
  const perPageCount = new Map<string, number>();
  const out: NotionBlockMatchHit[] = [];
  for (const hit of sorted) {
    const n = perPageCount.get(hit.page_id) ?? 0;
    if (n >= perPage) continue;
    perPageCount.set(hit.page_id, n + 1);
    out.push(hit);
    if (out.length >= top) break;
  }
  return out;
}

export async function matchNotionBlockEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<NotionBlockMatchHit[] | null> {
  const { data, error } = await admin.rpc("luna_match_notion_blocks", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? NOTION_INDEX_MATCH_THRESHOLD,
    match_count: opts?.limit ?? MATCH_OVERFETCH
  });
  if (error) {
    if (!isMissingRpc(error)) {
      console.error("[luna/notion-index] match rpc", error);
    }
    return null;
  }
  return (data ?? [])
    .map((row: Record<string, unknown>) => ({
      block_id: String(row.block_id ?? ""),
      page_id: String(row.page_id ?? ""),
      similarity: Number(row.similarity) || 0
    }))
    .filter(
      (r: NotionBlockMatchHit) =>
        r.block_id && r.page_id && r.similarity >= NOTION_INDEX_MATCH_THRESHOLD
    );
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
  const lines = [`계층: ${parentTitle}`];

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
      if (/ideation|아이데이션|제안|concept|컨셉/i.test(title)) score += 2;
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
    const branch = i === unique.length - 1 ? "└" : "├";
    lines.push(`  ${branch} ${t}`);
  });
  if (path.length > 0) {
    lines.push(`경로: ${path.join(" › ")}`);
  }
  return lines.join("\n");
}

function sectionLabel(blocks: IndexedBlockRow[]): string {
  const heading = blocks.find((b) =>
    /heading|title/i.test(b.block_type)
  );
  const pick = heading ?? blocks[0];
  if (!pick) return "";
  return pick.text.replace(/\s+/g, " ").trim().slice(0, 80);
}

function pageBlocksToSource(
  page: IndexedPageRow,
  blocks: IndexedBlockRow[],
  siblings: IndexedPageRow[],
  similarity: number,
  queryText?: string
): NotionSource {
  const body = blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n");
  const hierarchy = formatHierarchy({ page, siblings, queryText });
  const section = sectionLabel(blocks);
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
    title: page.title || "(제목 없음)",
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
    similarity
  };
}

async function buildIndexedSources(
  admin: SupabaseClient,
  hits: NotionBlockMatchHit[],
  queryText?: string
): Promise<{
  sources: NotionSource[];
  pages: IndexedPageRow[];
  selectedHits: NotionBlockMatchHit[];
}> {
  const selectedHits = selectNotionBlockHits(hits);
  if (selectedHits.length === 0) {
    return { sources: [], pages: [], selectedHits: [] };
  }

  const blockIds = selectedHits.map((h) => h.block_id);
  const pageIds = [...new Set(selectedHits.map((h) => h.page_id))];

  const [{ data: blockRows, error: blockErr }, { data: pageRows, error: pageErr }] =
    await Promise.all([
      admin
        .from("luna_notion_blocks")
        .select("block_id, page_id, block_type, text, position")
        .in("block_id", blockIds),
      admin
        .from("luna_notion_pages")
        .select(
          "page_id, title, parent_id, path_titles, nas_path, url, last_edited_time"
        )
        .in("page_id", pageIds)
    ]);

  if (blockErr) console.error("[luna/notion-index] blocks", blockErr);
  if (pageErr) console.error("[luna/notion-index] pages", pageErr);

  const blocks = (blockRows ?? []) as IndexedBlockRow[];
  const pages = (pageRows ?? []).map((p) => ({
    ...(p as IndexedPageRow),
    path_titles: asPathTitles((p as IndexedPageRow).path_titles)
  }));

  const parentIds = [
    ...new Set(pages.map((p) => p.parent_id).filter((id): id is string => Boolean(id)))
  ];
  // 형제는 parent당 최대 40개 — 프롬프트용 추려내기는 formatHierarchy에서
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
  const blocksByPage = new Map<string, IndexedBlockRow[]>();
  const simByPage = new Map<string, number>();
  const hitOrder = new Map(selectedHits.map((h, i) => [h.block_id, i]));

  for (const b of blocks) {
    const list = blocksByPage.get(b.page_id) ?? [];
    list.push(b);
    blocksByPage.set(b.page_id, list);
  }
  for (const h of selectedHits) {
    const prev = simByPage.get(h.page_id) ?? 0;
    if (h.similarity > prev) simByPage.set(h.page_id, h.similarity);
  }

  for (const [, list] of blocksByPage) {
    list.sort(
      (a, b) => (hitOrder.get(a.block_id) ?? 999) - (hitOrder.get(b.block_id) ?? 999)
    );
  }

  const sources: NotionSource[] = [];
  for (const pageId of pageIds) {
    const page = pageById.get(pageId);
    const pageBlocks = blocksByPage.get(pageId) ?? [];
    if (!page || pageBlocks.length === 0) continue;
    const sibs = siblings.filter(
      (s) => s.parent_id && s.parent_id === page.parent_id
    );
    sources.push(
      pageBlocksToSource(
        page,
        pageBlocks,
        sibs.length > 0 ? sibs : [page],
        simByPage.get(pageId) ?? 0,
        queryText
      )
    );
  }

  sources.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  // 백업 복제본 등 동일 제목은 최고 유사도·경로 있는 것만
  const byTitle = new Map<string, NotionSource>();
  for (const s of sources) {
    const key = s.title.toLowerCase().replace(/\s+/g, " ").trim();
    const prev = byTitle.get(key);
    if (!prev) {
      byTitle.set(key, s);
      continue;
    }
    const prevScore =
      (prev.similarity ?? 0) * 10 +
      (prev.nas_path || (prev.paths?.length ?? 0) > 0 ? 1 : 0);
    const nextScore =
      (s.similarity ?? 0) * 10 +
      (s.nas_path || (s.paths?.length ?? 0) > 0 ? 1 : 0);
    if (nextScore > prevScore) byTitle.set(key, s);
  }
  return {
    sources: capNotionDisplaySources([...byTitle.values()]),
    pages,
    selectedHits
  };
}

/**
 * 색인 우선 노션 검색.
 * - 임베딩 → luna_match_notion_blocks → 본문·계층
 * - 페이지 3건 미만이면 실시간 검색 보강
 * - 최근 2시간 수정 페이지만 실시간 본문 재조회
 */
export async function searchNotionForLuna(
  admin: SupabaseClient,
  keywords: string,
  queryContext?: string,
  opts?: { queryEmbedding?: number[] | null }
): Promise<NotionSearchOutcome> {
  const started = Date.now();
  const queryText = (queryContext?.trim() || keywords).trim();
  let embedding = opts?.queryEmbedding ?? null;
  if (!embedding && queryText) {
    // 색인 전용 경로 — 질문 임베딩이 없으면 여유 있게 한 번 생성
    embedding = await createQueryEmbedding(queryText, { timeoutMs: 8_000 });
  }

  let indexSources: NotionSource[] = [];
  let selectedHits: NotionBlockMatchHit[] = [];
  let pages: IndexedPageRow[] = [];
  let rpcFailed = false;

  if (embedding) {
    const rawHits = await matchNotionBlockEmbeddings(admin, embedding, {
      threshold: NOTION_INDEX_MATCH_THRESHOLD,
      limit: MATCH_OVERFETCH
    });
    if (rawHits === null) {
      rpcFailed = true;
    } else {
      const built = await buildIndexedSources(admin, rawHits, queryText);
      indexSources = built.sources;
      selectedHits = built.selectedHits;
      pages = built.pages;
    }
  }

  const pageCount = indexSources.length;
  const recentPages = pages.filter((p) => isRecentEdit(p.last_edited_time));
  // 임베딩 실패·RPC 실패·색인 페이지 3건 미만 → 실시간 보강
  const needSparseLive =
    !embedding || rpcFailed || pageCount < LIVE_IF_PAGES_BELOW;

  let liveOutcome: NotionSearchOutcome = {
    status: "skipped",
    sources: [],
    queries: ["index"],
    rounds: 0
  };

  if (needSparseLive) {
    liveOutcome = await searchNotionPages(keywords, queryContext);
  } else if (recentPages.length > 0) {
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
    // 색인 결과를 최신 본문으로 교체
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
    blocks: selectedHits.length,
    pages: pageCount,
    similarities: selectedHits.slice(0, 8).map((h) => ({
      page_id: h.page_id.slice(0, 8),
      sim: Number(h.similarity.toFixed(3))
    })),
    sparseLive: needSparseLive,
    recentRefresh: recentPages.length,
    liveSources: liveOutcome.sources.length,
    final: merged.sources.length,
    ms: Date.now() - started
  });

  return {
    ...merged,
    queries: [...new Set([...merged.queries, "index"])]
  };
}
