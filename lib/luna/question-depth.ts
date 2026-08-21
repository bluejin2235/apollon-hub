/**
 * 질문 깊이(단순/종합/목록) — LLM 주입량만 조절한다.
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
