/** 답 모순 판정 — 공유 타입·라벨 (클라이언트 가능) */

export const ANSWER_FLAG_IDS = [
  "scope_excess",
  "low_confidence",
  "intent_conf_gap",
  "slow",
  "unused_sources",
  "source_skew"
] as const;

export type AnswerFlagId = (typeof ANSWER_FLAG_IDS)[number];

export const ANSWER_FLAG_LABELS: Record<AnswerFlagId, string> = {
  scope_excess: "범위 과다",
  low_confidence: "자신감 미달",
  intent_conf_gap: "의도-자신감 역전",
  slow: "느림",
  unused_sources: "자료 불일치",
  source_skew: "출처 편중"
};

export const ANSWER_FLAG_HINTS: Record<AnswerFlagId, string> = {
  scope_excess: "단순한 질문에 검색 범위가 넓다",
  low_confidence: "찾긴 했는데 확신이 없다",
  intent_conf_gap: "알아들었는데 답을 못 했다",
  slow: "응답이 지나치게 길다",
  unused_sources: "쓸데없는 자료를 붙였다",
  source_skew: "다른 곳을 안 봤다"
};

export type AnswerFlagStatus = "pending" | "reviewed" | "ignored";
export type AnswerFlagVerdict = "good" | "bad" | "unclear";
export type AnswerFlagSource = "chat" | "mode_a" | "backfill";

export type AnswerFlagHit = {
  id: AnswerFlagId;
  label: string;
  hint: string;
};

export type AnswerFlagMetrics = {
  question_len?: number;
  intent_score?: number | null;
  confidence_score?: number | null;
  duration_ms?: number | null;
  search_ms?: number | null;
  embed_ms?: number | null;
  link_ms?: number | null;
  llm_ms?: number | null;
  candidates_found?: number | null;
  candidates_used?: number | null;
  notion_n?: number;
  wiki_n?: number;
  nas_n?: number;
  glossary_n?: number;
  memory_n?: number;
  total_docs?: number;
  search_ratio?: number | null;
  used_ratio?: number | null;
  dominant_source?: string | null;
  dominant_share?: number | null;
  mode_a_rank?: number | null;
  mode_a_top_n?: number | null;
};

/** 임계값 — 실측(볼팍 등) 반영한 최종안 */
export const ANSWER_FLAG_THRESHOLDS = {
  short_question_chars: 30,
  scope_docs_min: 20,
  /** 자신감 ≤ 이 값이면 미달 (7도 포함 — 쉬운 정의에 7이면 어긋남) */
  low_confidence_max: 7,
  intent_conf_gap_min: 2,
  slow_total_ms: 30_000,
  slow_search_ratio: 0.6,
  unused_found_min: 4,
  unused_ratio_max: 0.5,
  skew_docs_min: 10,
  skew_share_min: 0.9,
  /** 아침·탭에 하루에 보여줄 상한 */
  max_human_per_day: 20,
  /** 같은 모순 패턴 → 규칙 후보 */
  rule_promote_min: 3
} as const;

export function normalizeAskQuestion(question: string): string {
  return question
    .trim()
    .replace(/^[“”"'\s]+|[“”"'\s]+$/g, "")
    .replace(/[?？]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function groupAnswerFlagsByQuestion<
  T extends { question: string; created_at: string }
>(rows: T[]): Array<{ question: string; count: number; latest: T; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeAskQuestion(row.question) || "(질문 없음)";
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([question, items]) => {
      const latest = [...items].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      )[0];
      return { question, count: items.length, latest, items };
    })
    .sort(
      (a, b) =>
        b.count - a.count || b.latest.created_at.localeCompare(a.latest.created_at)
    );
}
