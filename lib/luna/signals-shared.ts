/** luna_signals — 부정·긍정·정정 신호를 한곳에 모은다. */

export type LunaSignalKind = "negative" | "positive" | "correction";

export type LunaSignalSource =
  | "thumbs"
  | "chat_correction"
  | "link_reject"
  | "question_answer"
  | "search_zero"
  | "followup";

export type LunaSignalSubjectType =
  | "answer"
  | "link"
  | "term"
  | "project"
  | "path"
  | "failure"
  | "question";

export type LunaSignalRow = {
  id: string;
  kind: LunaSignalKind;
  source: LunaSignalSource;
  subject_type: LunaSignalSubjectType;
  subject_id: string;
  reason: string | null;
  note: string | null;
  context: Record<string, unknown>;
  user_id: string | null;
  created_at: string;
};

export type InsertLunaSignalInput = {
  kind: LunaSignalKind;
  source: LunaSignalSource;
  subject_type: LunaSignalSubjectType;
  subject_id?: string | null;
  reason?: string | null;
  note?: string | null;
  context?: Record<string, unknown>;
  user_id?: string | null;
  created_at?: string | null;
};

/** 2차 데이터 ✕ 이유 */
export const LINK_REJECT_REASON_IDS = [
  "same_client_diff_job",
  "similar_name",
  "different_year",
  "other"
] as const;

export type LinkRejectReason = (typeof LINK_REJECT_REASON_IDS)[number];

export const LINK_REJECT_REASON_LABELS: Record<LinkRejectReason, string> = {
  same_client_diff_job: "발주처만 같고 건이 다름",
  similar_name: "이름이 비슷할 뿐",
  different_year: "연도가 다른 별건",
  other: "직접 입력"
};

export function isLinkRejectReason(value: unknown): value is LinkRejectReason {
  return (
    typeof value === "string" &&
    (LINK_REJECT_REASON_IDS as readonly string[]).includes(value)
  );
}

/** 대화 👎 — 새 선택지. 예전 값은 표시용으로만 남긴다. */
export const THUMBS_REASON_IDS = [
  "wrong_source",
  "not_wanted",
  "length_off",
  "too_slow",
  "other"
] as const;

export type ThumbsReason = (typeof THUMBS_REASON_IDS)[number];

export const THUMBS_REASON_LABELS: Record<ThumbsReason, string> = {
  wrong_source: "찾아준 자료가 틀렸어요",
  not_wanted: "맞긴 한데 제가 원한 게 아니에요",
  length_off: "답이 너무 길거나 짧아요",
  too_slow: "너무 느려요",
  other: "그 밖 — 직접 말할게요"
};

/** 예전 metadata.feedback_reason 표시 */
export const LEGACY_FEEDBACK_REASON_LABELS: Record<string, string> = {
  wrong: "내용이 틀렸다",
  not_found: "있는데 못 찾았다",
  too_long: "너무 길거나 장황하다",
  off_topic: "묻지 않은 걸 답했다",
  wrong_answer: "찾긴 했는데 답이 틀렸다",
  our_way: "아폴론 기준과 다르다",
  ...THUMBS_REASON_LABELS
};

export function isThumbsReason(value: unknown): value is ThumbsReason {
  return (
    typeof value === "string" &&
    (THUMBS_REASON_IDS as readonly string[]).includes(value)
  );
}

export function thumbsReasonLabel(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return LEGACY_FEEDBACK_REASON_LABELS[value] ?? value;
}
