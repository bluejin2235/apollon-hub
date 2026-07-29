import type { TrendMessage } from "@/lib/research/types";

function normalizeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export function resolveTrendMessageAuthorId(
  message: Pick<TrendMessage, "profile_id" | "profile">
): string | null {
  return normalizeId(message.profile_id ?? message.profile?.id);
}

export function isOwnTrendMessage(
  message: Pick<TrendMessage, "profile_id" | "profile" | "message_type">,
  currentUserId: string | null | undefined
): boolean {
  if (message.message_type === "ai") return false;
  const viewerId = normalizeId(currentUserId);
  const authorId = resolveTrendMessageAuthorId(message);
  return Boolean(viewerId && authorId && viewerId === authorId);
}

const WEEKLY_PIN_EXCLUDED_AI_MODELS = new Set(["pin-confirmation", "sns-guidance"]);

export function isWeeklyPinEligibleAiModel(aiModel: string | undefined): boolean {
  if (!aiModel || WEEKLY_PIN_EXCLUDED_AI_MODELS.has(aiModel)) return false;
  return (
    aiModel === "claude-sonnet-4-6" ||
    aiModel === "gemini-2.5-flash" ||
    aiModel.includes("claude-sonnet-4-6")
  );
}

export function shouldShowWeeklyPinButton(message: TrendMessage): boolean {
  if (message.message_type !== "ai") return false;

  const meta = message.metadata;
  const aiModel = meta?.ai_model;

  if (!aiModel || aiModel === "pin-confirmation") return false;
  if (meta?.is_pinned_notification === true) return false;
  if (!isWeeklyPinEligibleAiModel(aiModel)) return false;
  if (message.content.startsWith("📌")) return false;
  if (message.content.includes("생각 중")) return false;

  return true;
}
