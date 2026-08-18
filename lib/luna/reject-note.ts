import { clipFeedbackNote } from "@/lib/luna/feedback";

export const REJECT_ACTIONS = [
  "keep_both",
  "replace_with_new",
  "discard_new",
  "rewrite"
] as const;

export type RejectAction = (typeof REJECT_ACTIONS)[number];

export const REJECT_ACTION_LABELS: Record<RejectAction, string> = {
  keep_both: "둘 다 남기기",
  replace_with_new: "새 것으로 바꾸기",
  discard_new: "새 것 버리기",
  rewrite: "직접 고쳐 쓰기"
};

export function isRejectAction(value: unknown): value is RejectAction {
  return (
    typeof value === "string" &&
    (REJECT_ACTIONS as readonly string[]).includes(value)
  );
}

export function rejectActionLabel(value: unknown): string {
  if (isRejectAction(value)) return REJECT_ACTION_LABELS[value];
  return "";
}

export function clipRejectNote(value: unknown): string | null {
  return clipFeedbackNote(value);
}

export function mergeRejectMeta(
  prev: Record<string, unknown>,
  action: string | null,
  note: string | null
): Record<string, unknown> {
  const next = { ...prev };
  if (action && isRejectAction(action)) next.reject_action = action;
  else delete next.reject_action;
  if (note) next.reject_note = note;
  else delete next.reject_note;
  return next;
}

export function hasRejectMeta(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  const note =
    typeof meta.reject_note === "string" ? meta.reject_note.trim() : "";
  const action =
    typeof meta.reject_action === "string" ? meta.reject_action.trim() : "";
  return Boolean(note || action);
}
