/**
 * 확정 지식·용어사전 주입: 키워드 + (선택) 임베딩.
 * 임베딩 실패 시 키워드만으로 동작한다.
 */

import { normalizeSynonyms } from "@/lib/glossary/synonyms";
import { fuseKeywordAndEmbedding, type MatchVia } from "@/lib/luna/embedding";
import type { IdEmbeddingHit } from "@/lib/luna/embedding-search";

export const MATCHED_LEARNING_MAX = 8;
export const INJECT_LEARNING_MAX = 10;
export const WEB_AUGMENT_SETTINGS_KEY = "web_augment";

const STOPWORDS = new Set([
  "우리",
  "저희",
  "그것",
  "이것",
  "저것",
  "무엇",
  "뭐야",
  "뭔가",
  "어디",
  "어떻게",
  "알려줘",
  "있어",
  "있나",
  "하는",
  "인가",
  "관련",
  "대한",
  "대해",
  "그리고",
  "또는",
  "해서",
  "있는",
  "없는",
  "좀",
  "내일",
  "오늘",
  "어제",
  "직접",
  "하는가",
  "인가요",
  "해요",
  "해줘"
]);

/** 긴 조사부터. 2글자 이하로 줄어드는 절단은 하지 않는다. */
const PARTICLES = [
  "에서",
  "으로",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "로",
  "와",
  "과",
  "도",
  "만"
] as const;
const PARTICLE_RE = new RegExp(`(${PARTICLES.join("|")})$`);

function compactToken(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

const INTERNAL_Q_RE = /우리|아폴론|apollon|사내|워크서버|work서버|노션/i;
const GENERAL_INFO_RE =
  /날씨|기상|뉴스|주가|환율|시간|몇\s*시|최신|오늘\s*이슈|내일\s*날씨/i;

export type LearningMatchRow = {
  id: string;
  content: string;
  category: string;
  importance: number | null;
  use_count: number | null;
  created_at?: string | null;
  match_via?: MatchVia;
  keyword_score?: number;
  embedding_score?: number;
};

export type GlossaryMatchRow = {
  id?: string;
  term_ko: string | null;
  term_en?: string | null;
  synonyms?: unknown;
  definition?: string | null;
  match_via?: MatchVia;
  keyword_score?: number;
  embedding_score?: number;
};

export type KnowledgeInjectResult = {
  matched: LearningMatchRow[];
  other: LearningMatchRow[];
  all: LearningMatchRow[];
  ids: string[];
};

function glossaryProtectSet(
  rows: GlossaryMatchRow[] | undefined
): Set<string> {
  const set = new Set<string>();
  if (!rows) return set;
  for (const row of rows) {
    const fields = [
      row.term_ko ?? "",
      row.term_en ?? "",
      ...normalizeSynonyms(row.synonyms)
    ];
    for (const field of fields) {
      const key = compactToken(field.trim());
      if (key.length >= 2) set.add(key);
    }
  }
  return set;
}

export function parseWebAugmentEnabled(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as { enabled?: unknown }).enabled;
    if (typeof v === "boolean") return v;
  }
  return true;
}

export function splitKeywordQuery(
  extracted: string,
  fallbackText: string,
  glossary?: GlossaryMatchRow[]
): string[] {
  const protectedTokens = glossaryProtectSet(glossary);
  const fromExtract = tokenizeKeywords(extracted, protectedTokens);
  if (fromExtract.length > 0) return fromExtract;
  return tokenizeKeywords(
    fallbackNouns(fallbackText, protectedTokens).join(" "),
    protectedTokens
  );
}

function tokenizeKeywords(raw: string, protectedTokens: Set<string>): string[] {
  const text = raw.replace(/^["']|["']$/g, "").trim();
  if (!text) return [];
  const parts = text
    .split(/[\s,./|·•]+/)
    .map((p) => stripParticles(p.trim(), protectedTokens))
    .filter((p) => p.length >= 2 && !STOPWORDS.has(p));
  const extra = text.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [];
  const merged = [...parts];
  for (const e of extra) {
    const t = stripParticles(e, protectedTokens);
    if (t.length >= 2 && !STOPWORDS.has(t)) merged.push(t);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of merged) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function stripParticles(token: string, protectedTokens: Set<string>): string {
  let t = token.replace(/[?!.…,'"“”‘’]/g, "");
  if (protectedTokens.has(compactToken(t))) return t;
  let prev = "";
  while (t !== prev) {
    prev = t;
    const next = t.replace(PARTICLE_RE, "");
    if (next === t) break;
    if (next.length <= 2) break;
    if (protectedTokens.has(compactToken(t))) break;
    t = next;
  }
  return t;
}

function fallbackNouns(message: string, protectedTokens: Set<string>): string[] {
  return tokenizeKeywords(message, protectedTokens);
}

export function scoreKeywordHit(haystack: string, keyword: string): number {
  const h = haystack.toLowerCase();
  const k = keyword.toLowerCase().trim();
  if (k.length < 2) return 0;
  if (h.includes(k)) return 3;
  for (let len = k.length - 1; len >= 2; len -= 1) {
    for (let i = 0; i <= k.length - len; i += 1) {
      const sub = k.slice(i, i + len);
      if (h.includes(sub)) return 1;
    }
  }
  return 0;
}

function scoreAgainstKeywords(text: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    score += scoreKeywordHit(text, kw);
  }
  return score;
}

export function pickLearningsForQuestion(
  rows: LearningMatchRow[],
  keywords: string[],
  opts?: {
    dump?: boolean;
    embeddingHits?: IdEmbeddingHit[] | null;
    /** 전체 주입 상한 (기본 INJECT_LEARNING_MAX) */
    max?: number;
    /** 키워드·임베딩 매칭 상한 (기본 MATCHED_LEARNING_MAX) */
    matchedMax?: number;
  }
): KnowledgeInjectResult {
  if (opts?.dump) {
    return { matched: [], other: [], all: [], ids: [] };
  }
  const injectMax = opts?.max ?? INJECT_LEARNING_MAX;
  const matchedMax = Math.min(
    opts?.matchedMax ?? MATCHED_LEARNING_MAX,
    injectMax
  );
  const simById = new Map<string, number>();
  for (const hit of opts?.embeddingHits ?? []) {
    simById.set(hit.id, hit.similarity);
  }
  const scored = rows
    .map((row) => {
      const keywordScore = scoreAgainstKeywords(row.content, keywords);
      const fused = fuseKeywordAndEmbedding({
        keywordScore,
        similarity: simById.get(row.id)
      });
      return {
        row: {
          ...row,
          match_via: fused.match_via,
          keyword_score: fused.keyword_score,
          embedding_score: fused.embedding_score
        },
        score: fused.score
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.row.importance ?? 0) - (a.row.importance ?? 0));
  const matched = scored.slice(0, matchedMax).map((x) => x.row);
  const matchedIds = new Set(matched.map((r) => r.id));
  const popular = [...rows]
    .filter((r) => !matchedIds.has(r.id))
    .sort((a, b) => {
      const ia = a.importance ?? 0;
      const ib = b.importance ?? 0;
      if (ib !== ia) return ib - ia;
      const ta = a.created_at ?? "";
      const tb = b.created_at ?? "";
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
  const otherCap = Math.max(0, injectMax - matched.length);
  const other = matched.length > 0 ? popular.slice(0, otherCap) : [];
  const all = [...matched, ...other];
  return {
    matched,
    other,
    all,
    ids: all.map((r) => r.id)
  };
}

export function pickGlossaryForQuestion(
  rows: GlossaryMatchRow[],
  keywords: string[],
  embeddingHits?: IdEmbeddingHit[] | null
): GlossaryMatchRow[] {
  const simById = new Map<string, number>();
  for (const hit of embeddingHits ?? []) {
    simById.set(hit.id, hit.similarity);
  }
  const hits: Array<{ row: GlossaryMatchRow; score: number }> = [];
  for (const row of rows) {
    const fields = [
      row.term_ko ?? "",
      row.term_en ?? "",
      ...normalizeSynonyms(row.synonyms)
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    const hay = fields.join("\n");
    const keywordScore = keywords.length > 0 ? scoreAgainstKeywords(hay, keywords) : 0;
    const fused = fuseKeywordAndEmbedding({
      keywordScore,
      similarity: row.id ? simById.get(row.id) : undefined
    });
    if (fused.score <= 0) continue;
    hits.push({
      row: {
        ...row,
        match_via: fused.match_via,
        keyword_score: fused.keyword_score,
        embedding_score: fused.embedding_score
      },
      score: fused.score
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.map((h) => h.row);
}

export function formatMatchedLearningsBlock(opts: {
  matched: Array<{ content: string; category: string }>;
  other: Array<{ content: string; category: string }>;
}): string {
  const parts: string[] = [];
  if (opts.matched.length > 0) {
    const lines = opts.matched
      .map((l) => `- ${l.content} (${l.category})`)
      .join("\n");
    parts.push(`[질문과 관련된 것]\n${lines}`);
  }
  if (opts.other.length > 0) {
    const lines = opts.other
      .map((l) => `- ${l.content} (${l.category})`)
      .join("\n");
    parts.push(`[그 밖에 알고 있는 것]\n${lines}`);
  }
  return parts.join("\n\n");
}

export function shouldWebAugmentKnow(opts: {
  enabled: boolean;
  typeSlugs: string[];
  matchedKnowledge: number;
  matchedTerms: number;
  question: string;
  alreadyWeb: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.alreadyWeb) return false;
  if (opts.typeSlugs.includes("find")) return false;
  if (opts.matchedKnowledge > 0 || opts.matchedTerms > 0) return false;
  const isKnow = opts.typeSlugs.includes("know");
  const general = GENERAL_INFO_RE.test(opts.question);
  if (!isKnow && !general) return false;
  if (INTERNAL_Q_RE.test(opts.question) && !general) {
    return false;
  }
  return true;
}

/** 답변에 매칭 키워드가 실제로 있을 때만 true. 애매하면 false. */
export function learningUsedInAnswer(
  row: LearningMatchRow,
  answer: string,
  keywords: string[]
): boolean {
  const ans = answer.replace(/\s+/g, " ");
  if (!ans.trim()) return false;
  const hits = keywords.filter(
    (kw) => kw.length >= 2 && !STOPWORDS.has(kw) && ans.includes(kw)
  );
  if (hits.length === 0) return false;
  return scoreAgainstKeywords(row.content, hits) >= 3;
}
