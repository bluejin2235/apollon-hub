/**
 * 질문 깊이(단순/종합/목록) — LLM 주입량·답변 스타일·토큰 한도.
 * 검색 건수는 건드리지 않는다. 코드 패턴만 쓰고 LLM 유형에 의존하지 않는다.
 */
import { isListingQuestion } from "@/lib/luna/listing-question";
import type { WikiPickLimits } from "@/lib/luna/wiki-match";

export type QuestionDepth = "simple" | "synthesis" | "listing";

/** 종합형: 어떻게/왜/공통점/차이/흐름/비교 … */
export const SYNTHESIS_QUESTION_RE =
  /어떻게|왜\b|어째서|공통점|차이|흐름|비교|경위|정리해|요약해|진행\s*(?:됐|되었|됐어|했어|된)|뭘\s*배웠|인사이트|시사점/;

export function isSynthesisQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return SYNTHESIS_QUESTION_RE.test(t);
}

export function classifyQuestionDepth(text: string): QuestionDepth {
  if (isListingQuestion(text)) return "listing";
  if (isSynthesisQuestion(text)) return "synthesis";
  return "simple";
}

export type LlmInjectLimits = {
  notion: number;
  wikiSections: number;
  wikiPerDoc: number;
  learnings: number;
  cards: number;
  nas: number;
};

/** 단순 조회 3 · 종합 8 · 목록 12 */
export const LLM_INJECT_BY_DEPTH: Record<QuestionDepth, LlmInjectLimits> = {
  simple: {
    notion: 3,
    wikiSections: 3,
    wikiPerDoc: 2,
    learnings: 3,
    cards: 3,
    nas: 3
  },
  synthesis: {
    notion: 8,
    wikiSections: 8,
    wikiPerDoc: 1,
    learnings: 8,
    cards: 8,
    nas: 8
  },
  listing: {
    notion: 12,
    wikiSections: 12,
    wikiPerDoc: 1,
    learnings: 12,
    cards: 12,
    nas: 12
  }
};

/** talk.answer 의 짧은 채팅 규칙을 덮어쓴다 (목록형은 listing-question 규칙 사용) */
export const SYNTHESIS_ANSWER_RULE = `[종합형 질문 — 깊이 있게]
- talk.answer 의 "3~6줄·사례 2~3개·미리 다 설명하지 않는다·목록 재나열 금지" 규칙은 이번 턴에 적용하지 않는다.
- 길이 제한 없음. 짧게 줄이지 마라.
- 주어진 위키·노션·기억 사례를 빠짐없이 다룬다. 2~3개로 줄이지 마라.
- 각 항목에 근거 문서를 「」로 밝힌다. 마크다운 볼드(**)로 감싸지 마라.
- 반드시 이 구조로 쓴다:
  한 줄 요약
  · 항목 — 내용 (근거: 「문서」)
  · 항목 — 내용 (근거: 「문서」)
  · …
  마지막에 판단이나 한계
- 사람이 더 물어보게 남겨 두지 말고, 주어진 자료로 답할 수 있는 것은 이번 답에 다 쓴다.`;

export function llmInjectLimitsForQuestion(text: string): {
  depth: QuestionDepth;
  limits: LlmInjectLimits;
} {
  const depth = classifyQuestionDepth(text);
  return { depth, limits: LLM_INJECT_BY_DEPTH[depth] };
}

export function wikiLimitsForDepth(depth: QuestionDepth): WikiPickLimits {
  const lim = LLM_INJECT_BY_DEPTH[depth];
  return {
    sectionMax: lim.wikiSections,
    sectionsPerDocMax: lim.wikiPerDoc
  };
}

/** simple 은 talk.answer 유지. listing·synthesis 는 전용 규칙으로 대체 */
export function shouldOmitTalkAnswer(depth: QuestionDepth): boolean {
  return depth !== "simple";
}

/**
 * 답변 max_tokens.
 * simple 은 짧게(10초대), synthesis·listing 은 여유(25초대).
 */
export function answerMaxTokensForDepth(
  depth: QuestionDepth,
  hasAttachments: boolean
): number {
  if (hasAttachments) return 8192;
  if (depth === "simple") return 1024;
  return 8192;
}
