import { fuseKeywordAndEmbedding, type MatchVia } from "@/lib/luna/embedding";
import type { WikiEmbeddingHit } from "@/lib/luna/embedding-search";
import { wikiDocPath, type WikiDoc } from "@/lib/wiki/types";

export type WikiSourceRef = {
  slug: string;
  title: string;
  category: string;
  section_id: string;
  section_title: string;
  score: number;
  matched_keywords: string[];
  excerpt: string;
  path: string;
  visible_to_staff: boolean;
  cite_publicly: boolean;
  /** 디버깅용. 화면 출처에는 안 씀. */
  match_via?: MatchVia;
  keyword_score?: number;
  embedding_score?: number;
};

export const WIKI_SECTION_MAX = 3;
export const WIKI_SECTIONS_PER_DOC_MAX = 2;
export const WIKI_SECTION_BODY_MAX = 1500;

export type WikiPickLimits = {
  sectionMax: number;
  sectionsPerDocMax: number;
};

export const DEFAULT_WIKI_LIMITS: WikiPickLimits = {
  sectionMax: WIKI_SECTION_MAX,
  sectionsPerDocMax: WIKI_SECTIONS_PER_DOC_MAX
};

/** 목록형 질문: 여러 문서가 골고루 — 문서당 1절·상위 12절 (LLM 주입과 맞춤) */
export const LISTING_WIKI_LIMITS: WikiPickLimits = {
  sectionMax: 12,
  sectionsPerDocMax: 1
};

/** 종합형: 상위 8절 · 문서당 1 */
export const SYNTHESIS_WIKI_LIMITS: WikiPickLimits = {
  sectionMax: 8,
  sectionsPerDocMax: 1
};
const QUESTION_ALIAS_HINTS: Array<{ pattern: RegExp; aliases: string[] }> = [
  { pattern: /어떻게|절차|순서|프로세스|과정/, aliases: ["절차"] },
  { pattern: /왜|이유|목적/, aliases: ["목적", "이유"] },
  { pattern: /근거|출처|기준/, aliases: ["근거", "규칙", "기준"] },
  { pattern: /입력|받으면|받을\s*때/, aliases: ["입력", "입력 처리"] },
  { pattern: /출력|결과물|산출/, aliases: ["출력", "출력 형식"] },
  {
    pattern: /공공공간|공개공지|공공\s*프로젝트/,
    aliases: ["공개공지", "공공공간"]
  },
  {
    pattern: /어떤\s*게\s*있|어떤게\s*있|프로젝트.*(어떤|뭐)|목록|모아\s*줘|전부/,
    aliases: ["프로젝트", "제안", "공개공지"]
  }
];

export function splitWikiSourcesByVisibility(sources: WikiSourceRef[]): {
  public: WikiSourceRef[];
  private: WikiSourceRef[];
} {
  return {
    public: sources.filter((s) => s.cite_publicly !== false),
    private: sources.filter((s) => s.cite_publicly === false)
  };
}

const COMMON_KEYWORD_DOC_RATIO = 0.3;

function enrichKeywords(keywords: string[], questionText?: string): string[] {
  const merged = [...keywords];
  const seen = new Set(merged.map((k) => compactText(k)));
  const question = questionText?.trim() ?? "";
  if (!question) return merged;
  for (const hint of QUESTION_ALIAS_HINTS) {
    if (!hint.pattern.test(question)) continue;
    for (const alias of hint.aliases) {
      const key = compactText(alias);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(alias);
    }
  }
  return merged;
}

function compactText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function includesKeyword(text: string, keyword: string): boolean {
  const hay = compactText(text);
  const needle = compactText(keyword);
  if (needle.length < 2) return false;
  return hay.includes(needle);
}

function docHasKeyword(doc: WikiDoc, keyword: string): boolean {
  if (includesKeyword(doc.title, keyword) || includesKeyword(doc.summary, keyword)) {
    return true;
  }
  return doc.sections.some(
    (section) =>
      includesKeyword(section.title, keyword) || includesKeyword(section.body, keyword)
  );
}

function keywordWeights(docs: WikiDoc[], keywords: string[]): Map<string, number> {
  const active = docs.filter((d) => d.is_active);
  const total = active.length;
  const weights = new Map<string, number>();
  for (const keyword of keywords) {
    if (total === 0) {
      weights.set(keyword, 1);
      continue;
    }
    const hits = active.filter((d) => docHasKeyword(d, keyword)).length;
    weights.set(keyword, hits / total >= COMMON_KEYWORD_DOC_RATIO ? 1 / 3 : 1);
  }
  return weights;
}

function clipSectionBody(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= WIKI_SECTION_BODY_MAX) return trimmed;
  return `${trimmed.slice(0, WIKI_SECTION_BODY_MAX).trim()}...`;
}

function scoreSection(
  doc: WikiDoc,
  section: WikiDoc["sections"][number],
  keywords: string[],
  weights: Map<string, number>
) {
  let score = 0;
  let title_score = 0;
  let body_score = 0;
  let doc_title_score = 0;
  let summary_score = 0;
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const kw = keyword.trim();
    if (kw.length < 2) continue;
    const w = weights.get(kw) ?? 1;
    let hit = false;
    if (includesKeyword(section.title, kw)) {
      const add = 3 * w;
      score += add;
      title_score += add;
      hit = true;
    }
    if (includesKeyword(section.body, kw)) {
      const add = 2 * w;
      score += add;
      body_score += add;
      hit = true;
    }
    if (includesKeyword(doc.title, kw)) {
      const add = 2 * w;
      score += add;
      doc_title_score += add;
      hit = true;
    }
    if (includesKeyword(doc.summary, kw)) {
      const add = 1 * w;
      score += add;
      summary_score += add;
      hit = true;
    }
    if (hit) matched.add(kw);
  }
  return {
    score,
    title_score,
    body_score,
    doc_title_score,
    summary_score,
    matched_keywords: Array.from(matched)
  };
}

type ScoredWiki = WikiSourceRef & {
  title_score: number;
  body_score: number;
  doc_title_score: number;
  summary_score: number;
};

function toSourceRef(
  doc: WikiDoc,
  section: WikiDoc["sections"][number],
  fused: {
    score: number;
    keyword_score: number;
    embedding_score: number;
    match_via: MatchVia;
  },
  matched_keywords: string[],
  title_score: number,
  body_score: number,
  doc_title_score: number,
  summary_score: number
): ScoredWiki {
  const visible = doc.visible_to_staff !== false;
  return {
    slug: doc.slug,
    title: doc.title,
    category: doc.menu_slug,
    section_id: section.id,
    section_title: section.title,
    score: fused.score,
    matched_keywords,
    excerpt: clipSectionBody(section.body),
    path: wikiDocPath(doc.slug),
    visible_to_staff: visible,
    cite_publicly: visible,
    match_via: fused.match_via,
    keyword_score: fused.keyword_score,
    embedding_score: fused.embedding_score,
    title_score,
    body_score,
    doc_title_score,
    summary_score
  };
}

function compareScoredWiki(a: ScoredWiki, b: ScoredWiki): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.title_score !== a.title_score) return b.title_score - a.title_score;
  if (b.body_score !== a.body_score) return b.body_score - a.body_score;
  if (b.matched_keywords.length !== a.matched_keywords.length) {
    return b.matched_keywords.length - a.matched_keywords.length;
  }
  return a.title.localeCompare(b.title, "ko");
}

function stripScoredFields(row: ScoredWiki): WikiSourceRef {
  const {
    title_score: _t,
    body_score: _b,
    doc_title_score: _d,
    summary_score: _s,
    ...pub
  } = row;
  void _t;
  void _b;
  void _d;
  void _s;
  return pub;
}

/** 목록형: 문서당 최고 절만 남기고, 프로젝트 위키를 우선한다. */
function applyListingProjectBoost(
  scored: ScoredWiki[],
  questionText?: string
): ScoredWiki[] {
  const q = questionText?.trim() ?? "";
  if (!q || !/프로젝트|사례|공공|공개/.test(q)) return scored;
  return scored.map((row) =>
    row.category === "projects"
      ? { ...row, score: row.score + 6 }
      : row
  );
}

function pickTopWikiListing(
  scored: ScoredWiki[],
  limits: WikiPickLimits,
  questionText?: string
): WikiSourceRef[] {
  const boosted = applyListingProjectBoost(scored, questionText);
  const bestByDoc = new Map<string, ScoredWiki>();
  for (const row of boosted) {
    const prev = bestByDoc.get(row.slug);
    if (!prev || compareScoredWiki(row, prev) > 0) {
      bestByDoc.set(row.slug, row);
    }
  }
  const sorted = Array.from(bestByDoc.values()).sort(compareScoredWiki);
  return sorted
    .slice(0, limits.sectionMax)
    .map(stripScoredFields);
}

function pickTopWiki(
  scored: ScoredWiki[],
  limits: WikiPickLimits = DEFAULT_WIKI_LIMITS,
  questionText?: string
): WikiSourceRef[] {
  if (limits.sectionMax > DEFAULT_WIKI_LIMITS.sectionMax) {
    return pickTopWikiListing(scored, limits, questionText);
  }
  scored.sort(compareScoredWiki);
  const focused =
    scored.length >= 2 && scored[0] && scored[1] && scored[0].score - scored[1].score >= 3
      ? scored.filter((row) => row.score === scored[0]!.score)
      : scored;

  const perDoc = new Map<string, number>();
  const picked: WikiSourceRef[] = [];
  for (const row of focused) {
    const docCount = perDoc.get(row.slug) ?? 0;
    if (docCount >= limits.sectionsPerDocMax) continue;
    const {
      title_score: _t,
      body_score: _b,
      doc_title_score: _d,
      summary_score: _s,
      ...pub
    } = row;
    void _t;
    void _b;
    void _d;
    void _s;
    picked.push(pub);
    perDoc.set(row.slug, docCount + 1);
    if (picked.length >= limits.sectionMax) break;
  }
  return picked;
}

/**
 * 키워드 + (선택) 임베딩 유사도를 합쳐 상위 절을 고른다.
 * embeddingHits 가 없거나 실패해도 키워드만으로 동작한다.
 */
export function matchWikiSections(
  docs: WikiDoc[],
  keywords: string[],
  questionText?: string,
  embeddingHits?: WikiEmbeddingHit[] | null,
  limits: WikiPickLimits = DEFAULT_WIKI_LIMITS
): WikiSourceRef[] {
  const enriched = enrichKeywords(keywords, questionText);
  const weights = keywordWeights(docs, enriched);
  const byLib = new Map<string, WikiDoc>();
  for (const doc of docs) {
    if (doc.id) byLib.set(doc.id, doc);
  }

  const fused = new Map<string, ScoredWiki>();

  for (const doc of docs) {
    if (!doc.is_active) continue;
    for (const section of doc.sections) {
      const hit = scoreSection(doc, section, enriched, weights);
      if (hit.score < 1) continue;
      const key = `${doc.id ?? doc.slug}::${section.id}`;
      const f = fuseKeywordAndEmbedding({
        keywordScore: hit.score,
        similarity: null
      });
      fused.set(
        key,
        toSourceRef(
          doc,
          section,
          f,
          hit.matched_keywords,
          hit.title_score,
          hit.body_score,
          hit.doc_title_score,
          hit.summary_score
        )
      );
    }
  }

  for (const emb of embeddingHits ?? []) {
    const doc = byLib.get(emb.library_id);
    if (!doc || !doc.is_active) continue;
    const section = doc.sections.find((s) => s.id === emb.section_id);
    if (!section) continue;
    const key = `${doc.id}::${section.id}`;
    const prev = fused.get(key);
    const keywordScore = prev?.keyword_score ?? 0;
    const title_score = prev?.title_score ?? 0;
    const body_score = prev?.body_score ?? 0;
    const doc_title_score = prev?.doc_title_score ?? 0;
    const summary_score = prev?.summary_score ?? 0;
    const matched = prev?.matched_keywords ?? [];
    const f = fuseKeywordAndEmbedding({
      keywordScore,
      similarity: emb.similarity
    });
    if (f.score <= 0) continue;
    fused.set(
      key,
      toSourceRef(
        doc,
        section,
        f,
        matched,
        title_score,
        body_score,
        doc_title_score,
        summary_score
      )
    );
  }

  if (enriched.length === 0 && (!embeddingHits || embeddingHits.length === 0)) {
    return [];
  }

  return pickTopWiki(
    Array.from(fused.values()).filter((r) => r.score > 0),
    limits,
    questionText
  );
}

export function formatWikiSectionsBlock(hits: WikiSourceRef[]): string {
  if (hits.length === 0) return "";
  return [
    "[위키 문서 절]",
    ...hits.map((hit) => {
      if (hit.cite_publicly === false) {
        return `- 내부 기준 · 「${hit.section_title}」\n${hit.excerpt}\n(조건과 예외를 빼먹지 말고, 내부 기준을 썼다면 문서명은 밝히지 마라.)`;
      }
      return `- 「${hit.title}」 문서의 「${hit.section_title}」\n${hit.excerpt}\n(조건과 예외를 빼먹지 말고, 위키를 썼다면 문서명을 밝혀라.)`;
    })
  ].join("\n\n");
}

export function wikiSourceUsedInAnswer(hit: WikiSourceRef, answer: string): boolean {
  const text = answer.trim();
  if (!text) return false;
  if (
    hit.cite_publicly !== false &&
    (text.includes(`「${hit.title}」`) || text.includes(hit.title))
  ) {
    return true;
  }
  if (text.includes(`「${hit.section_title}」`) || text.includes(hit.section_title)) return true;
  const excerpt = hit.excerpt.replace(/\s+/g, " ").trim();
  if (excerpt.length >= 12 && text.includes(excerpt.slice(0, Math.min(36, excerpt.length)))) {
    return true;
  }
  return false;
}

export function normalizeWikiSources(raw: unknown): WikiSourceRef[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WikiSourceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const categoryRaw =
      typeof row.category === "string" ? row.category.trim() : "";
    const category = categoryRaw || "projects";
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const section_id = typeof row.section_id === "string" ? row.section_id.trim() : "";
    const section_title =
      typeof row.section_title === "string" ? row.section_title.trim() : "";
    const excerpt = typeof row.excerpt === "string" ? row.excerpt.trim() : "";
    const path = typeof row.path === "string" ? row.path.trim() : "";
    const score =
      typeof row.score === "number" && Number.isFinite(row.score)
        ? row.score
        : typeof row.score === "string" && row.score.trim()
          ? Number(row.score)
          : 0;
    const matched_keywords = Array.isArray(row.matched_keywords)
      ? row.matched_keywords.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    const visibleRaw = row.visible_to_staff;
    const citeRaw = row.cite_publicly;
    const visible_to_staff = visibleRaw === false ? false : true;
    const cite_publicly =
      citeRaw === false ? false : citeRaw === true ? true : visible_to_staff;
    if (!slug || !title || !section_id || !section_title || !path) continue;
    out.push({
      slug,
      title,
      category,
      section_id,
      section_title,
      score: Number.isFinite(score) ? score : 0,
      matched_keywords,
      excerpt,
      path,
      visible_to_staff,
      cite_publicly
    });
  }
  return out.length > 0 ? out : null;
}
