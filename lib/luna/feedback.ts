export const FEEDBACK_REASON_IDS = [
  "wrong",
  "not_found",
  "too_long",
  "off_topic",
  "other"
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASON_IDS)[number];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong: "틀렸다",
  not_found: "못 찾았다",
  too_long: "너무 길다",
  off_topic: "엉뚱하다",
  other: "기타"
};

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return (
    typeof value === "string" &&
    (FEEDBACK_REASON_IDS as readonly string[]).includes(value)
  );
}
