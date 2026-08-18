import { wikiDocPath, type WikiCategory, type WikiDoc } from "@/lib/wiki/types";

export const WIKI_SECTION_MAX = 3;
export const WIKI_SECTIONS_PER_DOC_MAX = 2;
export const WIKI_SECTION_BODY_MAX = 1500;
const QUESTION_ALIAS_HINTS: Array<{ pattern: RegExp; aliases: string[] }> = [
  { pattern: /어떻게|절차|순서|프로세스|과정/, aliases: ["절차"] },
  { pattern: /왜|이유|목적/, aliases: ["목적", "이유"] },
  { pattern: /근거|출처|기준/, aliases: ["근거", "규칙", "기준"] },
  { pattern: /입력|받으면|받을\s*때/, aliases: ["입력", "입력 처리"] },
  { pattern: /출력|결과물|산출/, aliases: ["출력", "출력 형식"] }
];

export type WikiSourceRef = {
  slug: string;
  title: string;
  category: WikiCategory;
  section_id: string;
  section_title: string;
  score: number;
  matched_keywords: string[];
  excerpt: string;
  path: string;
};

function enrichKeywords(keywords: string[], questionText?: string): string[] {
  const merged = [...keywords];
  const seen = new Set(merged.map((k) => normalizeText(k)));
  const question = questionText?.trim() ?? "";
  if (!question) return merged;
  for (const hint of QUESTION_ALIAS_HINTS) {
    if (!hint.pattern.test(question)) continue;
    for (const alias of hint.aliases) {
      const key = normalizeText(alias);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(alias);
    }
  }
  return merged;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesKeyword(text: string, keyword: string): boolean {
  const hay = normalizeText(text);
  const needle = normalizeText(keyword);
  if (needle.length < 2) return false;
  return hay.includes(needle);
}

function clipSectionBody(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= WIKI_SECTION_BODY_MAX) return trimmed;
  return `${trimmed.slice(0, WIKI_SECTION_BODY_MAX).trim()}...`;
}

function scoreSection(doc: WikiDoc, section: WikiDoc["sections"][number], keywords: string[]) {
  let score = 0;
  let title_score = 0;
  let body_score = 0;
  let doc_title_score = 0;
  let summary_score = 0;
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const kw = keyword.trim();
    if (kw.length < 2) continue;
    let hit = false;
    if (includesKeyword(section.title, kw)) {
      score += 3;
      title_score += 3;
      hit = true;
    }
    if (includesKeyword(section.body, kw)) {
      score += 2;
      body_score += 2;
      hit = true;
    }
    if (includesKeyword(doc.title, kw)) {
      score += 2;
      doc_title_score += 2;
      hit = true;
    }
    if (includesKeyword(doc.summary, kw)) {
      score += 1;
      summary_score += 1;
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

export function matchWikiSections(
  docs: WikiDoc[],
  keywords: string[],
  questionText?: string
): WikiSourceRef[] {
  const enriched = enrichKeywords(keywords, questionText);
  if (enriched.length === 0) return [];
  const scored: Array<
    WikiSourceRef & {
      title_score: number;
      body_score: number;
      doc_title_score: number;
      summary_score: number;
    }
  > = [];
  for (const doc of docs) {
    if (!doc.is_active) continue;
    for (const section of doc.sections) {
      const hit = scoreSection(doc, section, enriched);
      if (hit.score < 1) continue;
      scored.push({
        slug: doc.slug,
        title: doc.title,
        category: doc.category,
        section_id: section.id,
        section_title: section.title,
        score: hit.score,
        matched_keywords: hit.matched_keywords,
        excerpt: clipSectionBody(section.body),
        path: wikiDocPath(doc.category, doc.slug),
        title_score: hit.title_score,
        body_score: hit.body_score,
        doc_title_score: hit.doc_title_score,
        summary_score: hit.summary_score
      });
    }
  }
  const titleFocused = scored.some((row) => row.title_score > 0);
  const narrowed = titleFocused ? scored.filter((row) => row.title_score > 0) : scored;
  narrowed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.title_score !== a.title_score) return b.title_score - a.title_score;
    if (b.body_score !== a.body_score) return b.body_score - a.body_score;
    if (b.matched_keywords.length !== a.matched_keywords.length) {
      return b.matched_keywords.length - a.matched_keywords.length;
    }
    return a.title.localeCompare(b.title, "ko");
  });
  const focused =
    narrowed.length >= 2 && narrowed[0] && narrowed[1] && narrowed[0].score - narrowed[1].score >= 3
      ? narrowed.filter((row) => row.score === narrowed[0]!.score)
      : narrowed;

  const perDoc = new Map<string, number>();
  const picked: WikiSourceRef[] = [];
  for (const row of focused) {
    const docCount = perDoc.get(row.slug) ?? 0;
    if (docCount >= WIKI_SECTIONS_PER_DOC_MAX) continue;
    picked.push(row);
    perDoc.set(row.slug, docCount + 1);
    if (picked.length >= WIKI_SECTION_MAX) break;
  }
  return picked;
}

export function formatWikiSectionsBlock(hits: WikiSourceRef[]): string {
  if (hits.length === 0) return "";
  return [
    "[위키 문서 절]",
    ...hits.map(
      (hit) =>
        `- 「${hit.title}」 문서의 「${hit.section_title}」\n${hit.excerpt}\n(조건과 예외를 빼먹지 말고, 위키를 썼다면 문서명을 밝혀라.)`
    )
  ].join("\n\n");
}

export function wikiSourceUsedInAnswer(hit: WikiSourceRef, answer: string): boolean {
  const text = answer.trim();
  if (!text) return false;
  if (text.includes(`「${hit.title}」`) || text.includes(hit.title)) return true;
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
    const category =
      row.category === "forms" || row.category === "standards" || row.category === "rules"
        ? row.category
        : null;
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
    if (!category || !slug || !title || !section_id || !section_title || !path) continue;
    out.push({
      slug,
      title,
      category,
      section_id,
      section_title,
      score: Number.isFinite(score) ? score : 0,
      matched_keywords,
      excerpt,
      path
    });
  }
  return out.length > 0 ? out : null;
}
