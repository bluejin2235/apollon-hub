import type { WikiSourceRef } from "@/lib/luna/wiki-match";

/** 목록·나열형 질문 — 위키·지식으로 답하고 파일/노션 검색은 건너뛴다. */
export const LISTING_QUESTION_RE =
  /어떤\s*게\s*있|어떤게\s*있|뭐(?:가|뭐)\s*있|무엇(?:이|이\s*있)|목록|모아\s*줘|전부|몇\s*가지|어떤\s*것(?:들)?|사례(?:가|는)?\s*(?:있|뭐)/;

export function isListingQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return LISTING_QUESTION_RE.test(t);
}

/** 목록형이면 find를 빼고 know를 보장한다. */
export function applyListingTypeOverride(
  types: string[],
  questionText: string
): { types: string[]; switched: boolean } {
  if (!isListingQuestion(questionText)) {
    return { types, switched: false };
  }
  const next = types.filter((t) => t !== "find" && t !== "smalltalk");
  if (!next.includes("know")) next.unshift("know");
  const switched =
    types.includes("find") ||
    types.includes("smalltalk") ||
    !types.includes("know");
  return { types: next, switched };
}

export function wikiCoversKnowIntent(
  sources: WikiSourceRef[],
  listing: boolean
): boolean {
  if (sources.length === 0) return false;
  const uniqueDocs = new Set(sources.map((s) => s.slug)).size;
  if (listing) return uniqueDocs >= 2;
  return sources.length >= 2;
}

/** know+find 복합일 때 위키가 충분하면 find 커넥터 검색을 건너뛴다. */
export function shouldSkipFindConnectors(opts: {
  types: string[];
  wikiSources: WikiSourceRef[];
  listing: boolean;
}): boolean {
  if (!opts.types.includes("find")) return false;
  if (!opts.types.includes("know") && !opts.listing) return false;
  return wikiCoversKnowIntent(opts.wikiSources, opts.listing);
}
