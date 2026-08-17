export const FEEDBACK_REASON_IDS = [
  "wrong",
  "not_found",
  "too_long",
  "off_topic",
  "our_way",
  "other"
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASON_IDS)[number];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong: "내용이 틀렸다",
  not_found: "있는데 못 찾았다",
  too_long: "너무 길거나 장황하다",
  off_topic: "묻지 않은 걸 답했다",
  our_way: "우리 방식이 아니다",
  other: "기타"
};

export const FEEDBACK_NOTE_MAX = 300;

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return (
    typeof value === "string" &&
    (FEEDBACK_REASON_IDS as readonly string[]).includes(value)
  );
}

/** metadata.feedback_note — 빈 값은 null. 최대 300자. */
export function clipFeedbackNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, FEEDBACK_NOTE_MAX);
  return t || null;
}
