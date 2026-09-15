import {
  isThumbsReason,
  THUMBS_REASON_IDS,
  THUMBS_REASON_LABELS,
  LEGACY_FEEDBACK_REASON_LABELS,
  type ThumbsReason
} from "@/lib/luna/signals-shared";

/** @deprecated 이름 유지 — 실제 값은 새 👎 선택지 */
export const FEEDBACK_REASON_IDS = THUMBS_REASON_IDS;
export type FeedbackReason = ThumbsReason;

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  ...THUMBS_REASON_LABELS
};

export const FEEDBACK_NOTE_MAX = 300;

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return isThumbsReason(value);
}

export function feedbackReasonLabel(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return LEGACY_FEEDBACK_REASON_LABELS[value] ?? value;
}

/** metadata.feedback_note — 빈 값은 null. 최대 300자. */
export function clipFeedbackNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, FEEDBACK_NOTE_MAX);
  return t || null;
}
