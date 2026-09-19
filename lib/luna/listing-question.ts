import type { WikiSourceRef } from "@/lib/luna/wiki-match";

/**
 * 목록·나열형 질문.
 * 코드 패턴이 LLM 유형 판정보다 우선한다 (applyListingTypeOverride).
 */
export const LISTING_QUESTION_RE =
  /(?:어떤\s*게|어떤게)\s*있|뭐\s*가?\s*있|무엇이?\s*있|목록|모아\s*줘|전부|몇\s*가지|어떤\s*것들?|사례(?:가|는)?\s*(?:있|뭐)|사례\s*(?:를\s*)?(?:보여|알려)|레퍼런스\s*(?:를\s*)?(?:보여|알려)|건\s*(?:들\s*)?(?:중\s*)?(?:뭐|무엇)/;

export function isListingQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return LISTING_QUESTION_RE.test(t);
}

/**
 * 목록형이면 find를 빼고 know를 보장한다.
 * listing 인자가 있으면 그대로 쓰고, 없으면 questionText 로 판정한다.
 * LLM 이 find 를 줘도 코드 패턴이 목록형이면 이쪽이 이긴다.
 */
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

/**
 * know+find 복합일 때 위키가 충분하면 find 커넥터(실시간 API·도구 루프)를 건너뛴다.
 * 노션 색인·nas_directory 는 search-scope 플래그를 따른다.
 */
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
- "어떤 게 있지", "목록", "뭐가 있어", "사례 보여줘"처럼 여러 항목을 묻는 질문이다.
- talk.answer 의 "3~6줄·목록 재나열 금지·의견 우선·미리 다 설명하지 않는다" 규칙은 이번 턴에 적용하지 않는다. 나열이 먼저다.
- 질문 조건에 맞는 항목만 나열한다. "1건입니다"처럼 임의로 1건만 고르지 마라. 다만 본문은 최대 5개 — 더 있으면 상위 5개만 쓰고 끝에 「외에 관련 N건」만 적는다.
- 맞지 않는 자료는 언급하지 마라. 「조건과 맞지 않음」「해당 없음」「관련 없음」으로 하나씩 설명하는 것은 금지다.
- 각 항목은 번호 한 줄: 1. 이름 — 무엇을 했는지(한 문장) — 근거: 「문서 제목」 URL. 한글명·별칭이 있으면 함께 쓴다. URL이 자료에 있으면 반드시 붙인다.
- 페이지·문서 이름은 마크다운 볼드(**…**)로 감싸지 말고 「」로 쓴다. 제목을 모르면 근거·출처·**** 를 쓰지 마라.
- 반드시 이 구조:
  한 줄 요약
  1. 항목 — 내용 (근거: 「문서」 URL)
  2. …
  마지막에 판단·한계·가정(있을 때만). 예: 「다만 ○○는 제안 단계라 제외했습니다」
- 애매하지만 해당될 만한 것은 나열한 뒤, 목록 아래에 "다만 ~"로 덧붙인다. 전혀 무관한 문서는 빼라.
- 판단·분류·걸러내기는 나열이 끝난 뒤에만 한다. 나열보다 판단이 앞서면 안 된다.
- 주어진 자료 중 해당될 만한 것이 하나도 없을 때만 "없다"고 말한다.
- 길게 풀지 마라. 항목당 한 문장이면 충분하다.`;

export function listingAnswerRuleWithWikiCount(
  docCount: number,
  notionCount = 0
): string {
  const extras: string[] = [];
  if (docCount > 0) {
    extras.push(
      `- 이번에 [위키 문서 절] ${docCount}건이 주어졌다. 질문 조건에 맞는 것만 나열한다. 맞지 않으면 그 문서를 답에 쓰지 마라.`
    );
  }
  if (notionCount > 0) {
    extras.push(
      `- 이번에 [노션 검색 결과] ${notionCount}건이 주어졌다. 질문 조건에 해당할 만한 페이지만 나열하고, 각 줄에 근거 제목을 단다. 맞지 않는 페이지는 언급하지 마라.`
    );
  }
  if (extras.length === 0) return LISTING_ANSWER_RULE;
  return `${LISTING_ANSWER_RULE}\n${extras.join("\n")}`;
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
  return `[목록형 — 검토할 위키 ${lines.length}건]
${lines.join("\n")}
- 질문 조건에 맞는 문서만 · 이름 — 한 줄 설명 으로 쓴다.
- 맞지 않는 문서는 답에 쓰지 마라. 「조건과 맞지 않음」 나열은 금지다.`;
}

/** 목록형 — LLM에 넣은 노션 페이지 검토 강제 */
export function formatListingNotionChecklist(
  sources: Array<{ title: string; url?: string | null }>
): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s, i) => {
    const url = (s.url ?? "").trim();
    return url ? `${i + 1}. ${s.title} (${url})` : `${i + 1}. ${s.title}`;
  });
  return `[목록형 — 검토할 노션 ${lines.length}건]
${lines.join("\n")}
- 질문 조건에 맞는 페이지만 · 한 줄로 쓴다. 맞지 않으면 언급하지 마라.
- 「조건과 맞지 않음」으로 하나씩 설명하지 마라.`;
}
