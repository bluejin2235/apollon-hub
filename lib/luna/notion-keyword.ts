/**
 * 노션 색인 키워드 매칭 (위키와 같은 compact include + 흔한 말 1/3).
 * 위키 검색 로직은 건드리지 않는다 — 동일 규칙만 여기서 재구현·재사용.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMBEDDING_SCORE_WEIGHT,
  type MatchVia
} from "@/lib/luna/embedding";
import { splitKeywordQuery } from "@/lib/luna/knowledge-match";
import { matchNamedEntities, NAMED_ENTITY_SEED } from "@/lib/luna/named-entities";

/** 위키 wiki-match 와 동일: 공백 제거·소문자 */
export function compactKeywordText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** 위키 includesKeyword 와 동일 (compact substring) */
export function includesKeywordCompact(text: string, keyword: string): boolean {
  const hay = compactKeywordText(text);
  const needle = compactKeywordText(keyword);
  if (needle.length < 2) return false;
  return hay.includes(needle);
}

export const NOTION_KW_TITLE = 4;
export const NOTION_KW_HEADING = 3;
export const NOTION_KW_BODY = 2;
const COMMON_KEYWORD_DOC_RATIO = 0.3;

/** 노션 키워드용 — 질문 군더더기 (지식 매칭 STOP 과 별도) */
const NOTION_QUERY_NOISE = new Set([
  "우리",
  "우리가",
  "저희",
  "뭐가",
  "뭔가",
  "무엇",
  "어디",
  "어떻게",
  "알려줘",
  "있어",
  "있나",
  "하는",
  "관련",
  "대한",
  "대해",
  "그리고",
  "또는",
  "있는",
  "없는",
  "좀",
  "지금",
  "건",
  "건들",
  "라는",
  "이름이",
  "들어간",
  "같이",
  "했었지",
  "한",
  "뭘",
  "중인",
  "프로그램들",
  "프로젝트들",
  "공통점",
  "차이",
  "흐름",
  "이름",
  "프로그램"
]);

const TRAILING_PARTICLE_RE =
  /(이랑|랑|라는|들이|들은|부터|까지|에서|으로|으로서|이란|은|는|이|가|을|를|의|에|로|와|과|도|만|며)$/;

export type NotionKeywordChunkHit = {
  chunk_id: string;
  page_id: string;
  keyword_score: number;
};

export type NotionHybridChunkHit = {
  chunk_id: string;
  page_id: string;
  /** 임베딩 코사인 (없으면 0) */
  similarity: number;
  keyword_score: number;
  embedding_score: number;
  fused_score: number;
  match_via: MatchVia;
};

type PageTitleRow = { page_id: string; title: string };
type ChunkRow = {
  chunk_id: string;
  page_id: string;
  heading: string | null;
  text: string | null;
  position: number | null;
};

function stripTrailingParticle(kw: string): string {
  const t = kw.trim();
  if (t.length < 3) return t;
  const next = t.replace(TRAILING_PARTICLE_RE, "");
  return next.length >= 2 ? next : t;
}

/** 조사·어미 잔여 토큰 보정 (진행 중인 → 진행/중, 덱스터스튜디오랑 → 덱스터스튜디오) */
function expandKeywordVariants(keywords: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) return;
    if (NOTION_QUERY_NOISE.has(t.toLowerCase())) return;
    const key = compactKeywordText(t);
    if (key.length < 2 || seen.has(key)) return;
    if (NOTION_QUERY_NOISE.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  const stem = (kw: string) => {
    let s = stripTrailingParticle(kw);
    if (/인$/.test(s) && s.length >= 3) s = s.slice(0, -1);
    return s;
  };

  for (const kw of keywords) {
    push(kw);
    const s = stem(kw);
    if (s !== kw) push(s);
    const studio = s.match(/^(.{2,}?)스튜디오/);
    if (studio?.[1]) push(studio[1]);
  }
  // 원 토큰 순서 기준 바이그램 (진행+중 → 진행중) — 노이즈 토큰 제외
  const cleaned = keywords
    .map((k) => stem(k))
    .filter((k) => k.length >= 2 && !NOTION_QUERY_NOISE.has(k.toLowerCase()));
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const a = cleaned[i]!;
    const b = cleaned[i + 1]!;
    push(a + b);
  }
  return out;
}

export function notionSearchKeywords(
  extracted: string,
  questionText?: string
): string[] {
  const q = (questionText ?? extracted).trim();
  const base = splitKeywordQuery(extracted, q, []);
  const out = expandKeywordVariants(base);
  const seen = new Set(out.map((k) => compactKeywordText(k)));
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) return;
    const key = compactKeywordText(t);
    if (key.length < 2 || seen.has(key) || NOTION_QUERY_NOISE.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const ent of matchNamedEntities(q, NAMED_ENTITY_SEED)) {
    push(ent.canonical);
    for (const a of ent.aliases ?? []) push(a);
  }
  return out;
}

function keywordWeightsFromTitles(
  pages: PageTitleRow[],
  keywords: string[]
): Map<string, number> {
  const total = pages.length;
  const weights = new Map<string, number>();
  for (const keyword of keywords) {
    if (total === 0) {
      weights.set(keyword, 1);
      continue;
    }
    const hits = pages.filter((p) =>
      includesKeywordCompact(p.title ?? "", keyword)
    ).length;
    weights.set(
      keyword,
      hits / total >= COMMON_KEYWORD_DOC_RATIO ? 1 / 3 : 1
    );
  }
  return weights;
}

function scoreChunkAgainstKeywords(opts: {
  title: string;
  heading: string;
  text: string;
  keywords: string[];
  weights: Map<string, number>;
}): number {
  let score = 0;
  for (const keyword of opts.keywords) {
    const kw = keyword.trim();
    if (kw.length < 2) continue;
    const w = opts.weights.get(kw) ?? 1;
    // 영문·숫자 토큰은 제목/본문 일치 시 가중 (lucky 등)
    const latinBoost = /[a-z0-9]/i.test(kw) ? 1.5 : 1;
    if (includesKeywordCompact(opts.title, kw)) {
      score += NOTION_KW_TITLE * w * latinBoost;
    }
    if (includesKeywordCompact(opts.heading, kw)) {
      score += NOTION_KW_HEADING * w * latinBoost;
    }
    if (includesKeywordCompact(opts.text, kw)) {
      score += NOTION_KW_BODY * w * latinBoost;
    }
  }
  return score;
}

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * 키워드로 청크 후보를 모은다. 제목 히트 페이지는 청크가 없어도 대표 청크를 넣는다.
 */
export async function matchNotionChunksByKeyword(
  admin: SupabaseClient,
  keywordsIn: string[],
  opts?: { limit?: number }
): Promise<NotionKeywordChunkHit[]> {
  const keywords = keywordsIn
    .map((k) => k.trim())
    .filter((k) => compactKeywordText(k).length >= 2);
  if (keywords.length === 0) return [];

  const limit = opts?.limit ?? 60;

  const { data: pageRows, error: pageErr } = await admin
    .from("luna_notion_pages")
    .select("page_id, title")
    .eq("archived", false)
    .limit(8000);
  if (pageErr) {
    console.error("[luna/notion-keyword] pages", pageErr);
    return [];
  }
  const pages = (pageRows ?? []) as PageTitleRow[];
  const titleById = new Map(pages.map((p) => [p.page_id, p.title ?? ""]));

  // 제목 ilike 보강 — 전체 스캔에 빠진 페이지·표기 차이 보완
  await Promise.all(
    keywords.slice(0, 10).map(async (kw) => {
      const pattern = `%${escapeIlike(kw)}%`;
      const { data, error } = await admin
        .from("luna_notion_pages")
        .select("page_id, title")
        .eq("archived", false)
        .ilike("title", pattern)
        .limit(40);
      if (error) {
        console.error("[luna/notion-keyword] title ilike", kw, error);
        return;
      }
      for (const row of (data ?? []) as PageTitleRow[]) {
        if (!row.page_id) continue;
        titleById.set(row.page_id, row.title ?? "");
        if (!pages.some((p) => p.page_id === row.page_id)) {
          pages.push(row);
        }
      }
    })
  );

  const weights = keywordWeightsFromTitles(pages, keywords);
  const titleHitPageIds = [...titleById.entries()]
    .filter(([, title]) =>
      keywords.some((kw) => includesKeywordCompact(title ?? "", kw))
    )
    .map(([pageId]) => pageId);

  // 본문·heading ilike 후보 (긴 키워드·영문 우선)
  const chunkById = new Map<string, ChunkRow>();
  const kwForIlike = [...keywords]
    .sort((a, b) => {
      const score = (k: string) =>
        (/[a-z0-9]/i.test(k) ? 1000 : 0) + compactKeywordText(k).length;
      return score(b) - score(a);
    })
    .slice(0, 10);

  await Promise.all(
    kwForIlike.map(async (kw) => {
      const pattern = `%${escapeIlike(kw)}%`;
      const [h, t] = await Promise.all([
        admin
          .from("luna_notion_chunks")
          .select("chunk_id, page_id, heading, text, position")
          .ilike("heading", pattern)
          .limit(80),
        admin
          .from("luna_notion_chunks")
          .select("chunk_id, page_id, heading, text, position")
          .ilike("text", pattern)
          .limit(80)
      ]);
      if (h.error) console.error("[luna/notion-keyword] heading", h.error);
      if (t.error) console.error("[luna/notion-keyword] text", t.error);
      for (const row of [...(h.data ?? []), ...(t.data ?? [])] as ChunkRow[]) {
        if (row.chunk_id) chunkById.set(row.chunk_id, row);
      }
    })
  );

  // 제목만 맞은 페이지 → 대표 청크(position 최소)
  const missingTitlePages = titleHitPageIds.filter((pid) => {
    for (const c of chunkById.values()) {
      if (c.page_id === pid) return false;
    }
    return true;
  });
  if (missingTitlePages.length > 0) {
    const { data: reps, error: repErr } = await admin
      .from("luna_notion_chunks")
      .select("chunk_id, page_id, heading, text, position")
      .in("page_id", missingTitlePages.slice(0, 80))
      .order("position", { ascending: true })
      .limit(200);
    if (repErr) console.error("[luna/notion-keyword] title reps", repErr);
    const seenPage = new Set<string>();
    for (const row of (reps ?? []) as ChunkRow[]) {
      if (!row.chunk_id || seenPage.has(row.page_id)) continue;
      seenPage.add(row.page_id);
      chunkById.set(row.chunk_id, row);
    }
  }

  // 제목 히트 페이지의 모든 청크에도 +4 가 가도록, 이미 있는 페이지는 추가 청크 불필요
  // (점수 계산 시 title 기준으로 부여)

  const scored: NotionKeywordChunkHit[] = [];
  for (const chunk of chunkById.values()) {
    const title = titleById.get(chunk.page_id) ?? "";
    const keyword_score = scoreChunkAgainstKeywords({
      title,
      heading: chunk.heading ?? "",
      text: chunk.text ?? "",
      keywords,
      weights
    });
    if (keyword_score <= 0) continue;
    scored.push({
      chunk_id: chunk.chunk_id,
      page_id: chunk.page_id,
      keyword_score
    });
  }

  scored.sort((a, b) => b.keyword_score - a.keyword_score);
  return scored.slice(0, limit);
}

export function fuseNotionKeywordAndEmbedding(opts: {
  keywordScore: number;
  similarity: number | null | undefined;
}): Omit<NotionHybridChunkHit, "chunk_id" | "page_id"> {
  const keyword_score = Math.max(0, opts.keywordScore);
  const sim =
    typeof opts.similarity === "number" && Number.isFinite(opts.similarity)
      ? opts.similarity
      : 0;
  // 임베딩 RPC 를 통과한 후보면 임계값(0.3) 이미 만족 — 그대로 가산
  const embedding_score = sim > 0 ? sim * EMBEDDING_SCORE_WEIGHT : 0;
  const fused_score = keyword_score + embedding_score;
  const match_via: MatchVia =
    keyword_score > 0 && embedding_score > 0
      ? "both"
      : embedding_score > 0
        ? "embedding"
        : "keyword";
  return {
    similarity: sim,
    keyword_score,
    embedding_score,
    fused_score,
    match_via
  };
}

/** 임베딩 히트 + 키워드 히트 합집합. 정렬 키는 fused_score. */
export function mergeNotionHybridChunkHits(
  embeddingHits: Array<{
    chunk_id: string;
    page_id: string;
    similarity: number;
  }>,
  keywordHits: NotionKeywordChunkHit[]
): NotionHybridChunkHit[] {
  const byId = new Map<
    string,
    { page_id: string; similarity: number; keyword_score: number }
  >();

  for (const h of embeddingHits) {
    if (!h.chunk_id) continue;
    byId.set(h.chunk_id, {
      page_id: h.page_id,
      similarity: h.similarity,
      keyword_score: 0
    });
  }
  for (const h of keywordHits) {
    if (!h.chunk_id) continue;
    const prev = byId.get(h.chunk_id);
    if (!prev) {
      byId.set(h.chunk_id, {
        page_id: h.page_id,
        similarity: 0,
        keyword_score: h.keyword_score
      });
    } else {
      prev.keyword_score = Math.max(prev.keyword_score, h.keyword_score);
    }
  }

  const out: NotionHybridChunkHit[] = [];
  for (const [chunk_id, v] of byId) {
    const fused = fuseNotionKeywordAndEmbedding({
      keywordScore: v.keyword_score,
      similarity: v.similarity > 0 ? v.similarity : null
    });
    if (fused.fused_score <= 0) continue;
    // 제목급 키워드 히트는 중위 임베딩(~0.45→4.5)보다 앞에 오도록 바닥을 둔다
    let fused_score = fused.fused_score;
    if (v.keyword_score >= NOTION_KW_TITLE) {
      fused_score = Math.max(fused_score, v.keyword_score + 6);
    }
    out.push({
      chunk_id,
      page_id: v.page_id,
      similarity: fused.similarity,
      keyword_score: fused.keyword_score,
      embedding_score: fused.embedding_score,
      fused_score,
      match_via: fused.match_via
    });
  }
  out.sort((a, b) => b.fused_score - a.fused_score);
  return out;
}
