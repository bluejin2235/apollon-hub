/**
 * 실패 원인 유형 — 규칙 기반 (LLM 없음). 조회 시 계산.
 *
 * 우선순위는 「무엇을 고치면 몇 건이 풀리나」다.
 * thumbs_down 은 알게 된 경로일 뿐, 원인을 가리지 않는다.
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
  /규정|기준|절차|규칙|정책|양식|가이드|매뉴얼|지침|프로세스|어떻게\s*해|해야\s*하|제출|결재|승인|복지|야근|휴가|병가|인허가|뭐야|뭐고|무슨\s*뜻/;

const FIND_RE =
  /찾아줘|찾아\s*줘|어디\s*있|위치|보여줘|모아줘|파일\s*최종|견적서/;

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
  return false;
}

function isFindQuestion(q: string): boolean {
  return FIND_RE.test(q);
}

function isWikiTopic(q: string): boolean {
  return WIKI_TOPIC_RE.test(q);
}

/**
 * 우선순위: 되묻기 → 위키 공백 → 검색 실패 → 얕은 답 → 의도 → 사람 정정(잔여) → 느림 → 미분류
 * thumbs_down 은 원인보다 나중에. 검색·위키 원인을 가리지 않기 위함.
 */
export function classifyFailureCause(
  row: CauseClassifyInput
): FailureCauseType {
  const q = row.question || "";
  const answer = (row.answer_excerpt || "").replace(/\s+/g, " ").trim();
  const src = failureSourceTotals(row.sources_used);

  if (isLikelyClarifyPickQuestion(q)) {
    return "clarify_mishandle";
  }
  if (
    isClarifyFollowup(row) &&
    answer.length > 0 &&
    answer.length <= SHORT_ANSWER_CHARS
  ) {
    return "clarify_mishandle";
  }

  if (isWikiTopic(q) && src.wiki === 0) {
    return "wiki_gap";
  }

  if (hasSignal(row, "zero_search") || hasSignal(row, "not_found")) {
    return "search_miss";
  }
  if (
    isFindQuestion(q) &&
    !isWikiTopic(q) &&
    (src.notion === 0 && src.cards === 0 && src.wiki === 0)
  ) {
    return "search_miss";
  }
  if (
    isFindQuestion(q) &&
    !isWikiTopic(q) &&
    (hasSignal(row, "thumbs_down") || hasSignal(row, "correction"))
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
  if (hasSignal(row, "low_confidence") && src.materials >= SHALLOW_SOURCE_MIN) {
    return "shallow_answer";
  }

  if (
    hasSignal(row, "low_intent") ||
    hasSignal(row, "unclassified") ||
    (typeof row.intent_score === "number" && row.intent_score <= 4)
  ) {
    return "low_understanding";
  }

  if (hasSignal(row, "thumbs_down") || hasSignal(row, "correction")) {
    return "human_correction";
  }

  if (typeof row.duration_ms === "number" && row.duration_ms >= SLOW_MS) {
    return "slow_response";
  }

  return "unclassified";
}

export function failureCauseMeta(type: FailureCauseType): FailureCauseMeta {
  return FAILURE_CAUSE_META[type] ?? FAILURE_CAUSE_META.unclassified;
}
