/**
 * 실패 원인 유형 — 규칙 기반 (LLM 없음). 조회 시 계산.
 */
import {
  isLikelyClarifyPickQuestion,
  type FailureSignal
} from "@/lib/luna/failures-shared";

export type FailureCauseType =
  | "search_miss"
  | "wiki_gap"
  | "clarify_mishandle"
  | "shallow_answer"
  | "slow_response"
  | "human_correction"
  | "low_understanding"
  | "unclassified";

export type FailureCauseMeta = {
  type: FailureCauseType;
  emoji: string;
  title: string;
  blurb: string;
};

export const FAILURE_CAUSE_META: Record<FailureCauseType, FailureCauseMeta> = {
  search_miss: {
    type: "search_miss",
    emoji: "🔍",
    title: "검색이 문서를 못 찾음",
    blurb: "찾아야 할 문서를 못 가져옴"
  },
  wiki_gap: {
    type: "wiki_gap",
    emoji: "📗",
    title: "위키에 없는 규정",
    blurb: "위키에 문서가 없음"
  },
  clarify_mishandle: {
    type: "clarify_mishandle",
    emoji: "💬",
    title: "되묻고 답을 못 알아들음",
    blurb: "선택지 답을 못 알아들음"
  },
  shallow_answer: {
    type: "shallow_answer",
    emoji: "📝",
    title: "자료는 찾았는데 답이 얕음",
    blurb: "찾았는데 제대로 못 씀"
  },
  slow_response: {
    type: "slow_response",
    emoji: "🐢",
    title: "응답이 너무 느림",
    blurb: "너무 느림"
  },
  human_correction: {
    type: "human_correction",
    emoji: "👤",
    title: "사람이 틀렸다고 함",
    blurb: "내용이 틀림"
  },
  low_understanding: {
    type: "low_understanding",
    emoji: "❓",
    title: "질문 의도를 못 잡음",
    blurb: "의도·분류가 흔들림"
  },
  unclassified: {
    type: "unclassified",
    emoji: "▫️",
    title: "미분류",
    blurb: "규칙에 안 걸림"
  }
};

/** 표시·필터용 순서 (미분류는 맨 뒤) */
export const FAILURE_CAUSE_ORDER: FailureCauseType[] = [
  "search_miss",
  "wiki_gap",
  "clarify_mishandle",
  "shallow_answer",
  "slow_response",
  "human_correction",
  "low_understanding",
  "unclassified"
];

const WIKI_TOPIC_RE =
  /규정|기준|절차|규칙|정책|양식|가이드|매뉴얼|지침|프로세스|어떻게\s*해|해야\s*하|제출|결재|승인/;

const SLOW_MS = 25_000;
const SHALLOW_SOURCE_MIN = 3;
const SHALLOW_CONF_MAX = 5;
const SHORT_ANSWER_CHARS = 90;

export type CauseClassifyInput = {
  question: string;
  answer_excerpt?: string | null;
  signal: string;
  signals?: string[] | null;
  intent_score?: number | null;
  confidence_score?: number | null;
  sources_used?: Record<string, unknown> | null;
  duration_ms?: number | null;
  types?: string[] | null;
  source_ref?: Record<string, unknown> | null;
};

function numSource(
  sources: Record<string, unknown> | null | undefined,
  key: string
): number {
  const v = sources?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function failureSourceTotals(
  sources: Record<string, unknown> | null | undefined
): {
  wiki: number;
  notion: number;
  memory: number;
  cards: number;
  materials: number;
} {
  const wiki = numSource(sources, "wiki");
  const notion = numSource(sources, "notion");
  const memory = numSource(sources, "memory");
  const cards = numSource(sources, "cards");
  return {
    wiki,
    notion,
    memory,
    cards,
    /** 검색·위키 자료 (기억 주입은 제외) */
    materials: wiki + notion + cards
  };
}

function allSignals(row: CauseClassifyInput): string[] {
  if (Array.isArray(row.signals) && row.signals.length > 0) {
    return row.signals;
  }
  return row.signal ? [row.signal] : [];
}

function hasSignal(row: CauseClassifyInput, s: FailureSignal | string): boolean {
  return allSignals(row).includes(s);
}

function isClarifyFollowup(row: CauseClassifyInput): boolean {
  const ref = row.source_ref;
  if (ref && typeof ref === "object") {
    if (ref.last_had_clarify === true || ref.clarify_followup === true) {
      return true;
    }
  }
  return isLikelyClarifyPickQuestion(row.question || "");
}

/**
 * 우선순위: 사람 정정 → 되묻기 → 위키 공백 → 검색 실패 → 얕은 답 → 느림 → 의도 → 미분류
 */
export function classifyFailureCause(
  row: CauseClassifyInput
): FailureCauseType {
  if (hasSignal(row, "thumbs_down") || hasSignal(row, "correction")) {
    return "human_correction";
  }

  const answer = (row.answer_excerpt || "").replace(/\s+/g, " ").trim();
  if (
    isClarifyFollowup(row) &&
    (answer.length > 0 && answer.length <= SHORT_ANSWER_CHARS ||
      hasSignal(row, "not_found") ||
      hasSignal(row, "low_confidence"))
  ) {
    return "clarify_mishandle";
  }

  const src = failureSourceTotals(row.sources_used);
  const q = row.question || "";

  if (src.wiki === 0 && WIKI_TOPIC_RE.test(q)) {
    return "wiki_gap";
  }

  if (
    hasSignal(row, "zero_search") ||
    hasSignal(row, "not_found") ||
    src.materials === 0 ||
    (src.notion === 0 && src.cards === 0 && src.wiki === 0)
  ) {
    return "search_miss";
  }

  if (
    src.materials >= SHALLOW_SOURCE_MIN &&
    typeof row.confidence_score === "number" &&
    row.confidence_score <= SHALLOW_CONF_MAX
  ) {
    return "shallow_answer";
  }

  if (typeof row.duration_ms === "number" && row.duration_ms >= SLOW_MS) {
    return "slow_response";
  }

  if (
    hasSignal(row, "low_intent") ||
    hasSignal(row, "unclassified") ||
    (typeof row.intent_score === "number" && row.intent_score <= 4)
  ) {
    return "low_understanding";
  }

  if (hasSignal(row, "low_confidence")) {
    return src.materials >= SHALLOW_SOURCE_MIN
      ? "shallow_answer"
      : "search_miss";
  }

  return "unclassified";
}

export function failureCauseMeta(type: FailureCauseType): FailureCauseMeta {
  return FAILURE_CAUSE_META[type] ?? FAILURE_CAUSE_META.unclassified;
}
