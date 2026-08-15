import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  isFeedbackReason,
  type FeedbackReason
} from "@/lib/luna/feedback";

export type MessageFeedbackValue = "good" | "bad" | null;

export type SaveFeedbackResult =
  | {
      ok: true;
      feedback: MessageFeedbackValue;
      reason: FeedbackReason | null;
    }
  | { ok: false; status: number; error: string };

function asMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

export async function saveLunaMessageFeedback(
  admin: SupabaseClient,
  user: User,
  opts: {
    messageId: string;
    feedback: MessageFeedbackValue;
    reason?: FeedbackReason | null;
  }
): Promise<SaveFeedbackResult> {
  const messageId = opts.messageId.trim();
  if (!messageId) {
    return { ok: false, status: 400, error: "message_id is required" };
  }

  const { data: message, error: msgError } = await admin
    .from("luna_messages")
    .select("id, conversation_id, role, metadata")
    .eq("id", messageId)
    .maybeSingle();

  if (msgError) {
    console.error("[luna/messages] select", msgError);
    return { ok: false, status: 500, error: msgError.message };
  }
  if (!message) {
    return { ok: false, status: 404, error: "Not found" };
  }
  if (message.role !== "assistant") {
    return { ok: false, status: 400, error: "Only assistant messages can be rated" };
  }

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id")
    .eq("id", message.conversation_id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/messages] conversation", convError);
    return { ok: false, status: 500, error: convError.message };
  }
  if (!conversation) {
    return { ok: false, status: 404, error: "Not found" };
  }

  const isOwner = conversation.user_id === user.id;
  if (!isOwner && !(await isSuperAdminUser(admin, user))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const prevMeta = asMeta(message.metadata);
  const nextMeta = { ...prevMeta };

  if (opts.feedback == null) {
    delete nextMeta.feedback;
    delete nextMeta.feedback_at;
    delete nextMeta.feedback_reason;
  } else {
    nextMeta.feedback = opts.feedback;
    nextMeta.feedback_at = new Date().toISOString();
    if (opts.feedback === "bad") {
      if (opts.reason) nextMeta.feedback_reason = opts.reason;
    } else {
      delete nextMeta.feedback_reason;
    }
  }

  const { data: updated, error: updateError } = await admin
    .from("luna_messages")
    .update({ metadata: nextMeta })
    .eq("id", messageId)
    .select("id, metadata")
    .maybeSingle();

  if (updateError) {
    console.error("[luna/messages] update", updateError);
    return { ok: false, status: 500, error: updateError.message };
  }
  if (!updated) {
    return { ok: false, status: 500, error: "Update did not persist" };
  }

  const savedMeta = asMeta(updated.metadata);
  const savedFeedback =
    savedMeta.feedback === "good" || savedMeta.feedback === "bad"
      ? savedMeta.feedback
      : null;
  if (opts.feedback !== savedFeedback) {
    return { ok: false, status: 500, error: "Update did not persist" };
  }

  return {
    ok: true,
    feedback: savedFeedback,
    reason: isFeedbackReason(savedMeta.feedback_reason)
      ? savedMeta.feedback_reason
      : null
  };
}
