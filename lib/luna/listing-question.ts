import type { WikiSourceRef } from "@/lib/luna/wiki-match";

/** 목록·나열형 질문 — 위키·지식으로 답하고 파일/노션 검색은 건너뛴다. */
export const LISTING_QUESTION_RE =
  /어떤\s*게\s*있|어떤게\s*있|뭐(?:가|뭐)\s*있|무엇(?:이|이\s*있)|목록|모아\s*줘|전부|몇\s*가지|어떤\s*것(?:들)?|사례(?:가|는)?\s*(?:있|뭐)/;

export function isListingQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return LISTING_QUESTION_RE.test(t);
}

/** 목록형이면 find를 빼고 know를 보장한다. questionText 또는 listing 플래그로 적용. */
export function applyListingTypeOverride(
  types: string[],
  questionText: string,
  listing = isListingQuestion(questionText)
): { types: string[]; switched: boolean } {
  if (!listing) {
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

/** 목록형 know 답변 — type.know 와 함께 주입한다. 별도 type.list DB 유형은 쓰지 않는다. */
export const LISTING_ANSWER_RULE = `[목록형 질문 — 나열 우선]
- "어떤 게 있지", "목록", "뭐가 있어"처럼 여러 항목을 묻는 질문이다.
- talk.answer 의 "목록 재나열 금지·의견 우선" 규칙은 이번 턴에 적용하지 않는다. 나열이 먼저다.
- 첫 문장부터 · 불릿 목록으로 시작한다. "없다", "확정 불가", "해당 사례 없음" 같은 총평·판단을 목록 앞에 두지 않는다.
- [위키 문서 절]에 주어진 문서를 빠짐없이 훑고, 질문 조건에 해당할 만한 것을 전부 나열한다.
- 각 항목은 한 줄: · 이름 — 무엇을 했는지 (한 문장). 위키에 한글명·별칭이 있으면 함께 쓴다.
- 애매하거나 확인이 더 필요한 것도 빼지 말고 나열한 뒤, 목록 아래에 "다만 ~"로 덧붙인다.
- 판단·분류·걸러내기는 나열이 끝난 뒤에만 한다. 나열보다 판단이 앞서면 안 된다.
- "확인 불가", "분류하기 어렵다", "조건에 맞을 가능성"만으로 항목을 통째로 생략하지 마라.
- 주어진 위키 절 중 해당될 만한 것이 하나도 없을 때만 "없다"고 말한다.`;

export function listingAnswerRuleWithWikiCount(docCount: number): string {
  if (docCount <= 0) return LISTING_ANSWER_RULE;
  return `${LISTING_ANSWER_RULE}\n- 이번에 [위키 문서 절] ${docCount}건이 주어졌다. 각 문서를 검토해 해당될 만한 항목을 빠짐없이 나열한다.`;
}

/** volatile 블록 — 위키 절 바로 뒤에 넣어 문서별 검토를 강제한다. */
export function formatListingWikiChecklist(hits: WikiSourceRef[]): string {
  const bySlug = new Map<string, string>();
  for (const hit of hits) {
    if (!bySlug.has(hit.slug)) bySlug.set(hit.slug, hit.title);
  }
  if (bySlug.size === 0) return "";
  const lines = [...bySlug.entries()].map(
    ([slug, title], i) => `${i + 1}. ${title} (slug:${slug})`
  );
  return `[목록형 — 반드시 검토할 위키 ${lines.length}건]
${lines.join("\n")}
- 위 ${lines.length}개 문서 각각에 대해 · 이름 — 한 줄 설명 을 쓴다. 빠뜨리지 않는다.
- 해당 없으면 · 이름 — 조건과 맞지 않음 (이유 한 줄) 로 쓴다.
- "확인 불가"만으로 해당 문서 줄 자체를 생략하지 않는다.`;
}
