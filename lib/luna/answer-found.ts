import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { kstWeekBounds } from "@/lib/luna/self-report";
import {
  formatFoundWeekLabel,
  isFoundReason,
  type FoundReason
} from "@/lib/luna/answer-found-shared";

export {
  FOUND_REASONS,
  formatFoundWeekLabel,
  isFoundReason,
  type FoundReason
} from "@/lib/luna/answer-found-shared";

export type AnswerFoundRow = {
  found: boolean;
  reason: FoundReason | null;
};

export type FoundWeekStats = {
  total: number;
  found_count: number;
  pct: number | null;
  label: string;
};

export async function getFoundWeekStats(
  admin: SupabaseClient,
  now = new Date()
): Promise<FoundWeekStats> {
  const week = kstWeekBounds(now);
  const { data, error } = await admin
    .from("luna_answer_found")
    .select("found")
    .gte("created_at", week.startIso)
    .lt("created_at", week.endIso);

  if (error) {
    console.error("[luna/answer-found] week stats", error);
    return {
      total: 0,
      found_count: 0,
      pct: null,
      label: formatFoundWeekLabel({ total: 0, found_count: 0, pct: null })
    };
  }

  const rows = data ?? [];
  const total = rows.length;
  const found_count = rows.filter((r) => r.found === true).length;
  const pct = total > 0 ? Math.round((found_count / total) * 100) : null;
  return {
    total,
    found_count,
    pct,
    label: formatFoundWeekLabel({ total, found_count, pct })
  };
}

export async function getAnswerFoundForMessage(
  admin: SupabaseClient,
  messageId: string,
  userId: string
): Promise<AnswerFoundRow | null> {
  const { data, error } = await admin
    .from("luna_answer_found")
    .select("found, reason")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[luna/answer-found] get", error);
    return null;
  }
  if (!data) return null;
  return {
    found: data.found === true,
    reason: isFoundReason(data.reason) ? data.reason : null
  };
}

export type SaveAnswerFoundResult =
  | { ok: true; found: boolean; reason: FoundReason | null }
  | { ok: false; status: number; error: string };

export async function saveAnswerFound(
  admin: SupabaseClient,
  user: User,
  opts: {
    messageId: string;
    found: boolean;
    reason?: FoundReason | null;
  }
): Promise<SaveAnswerFoundResult> {
  const messageId = opts.messageId.trim();
  if (!messageId) {
    return { ok: false, status: 400, error: "message_id is required" };
  }
  if (opts.found === false && !isFoundReason(opts.reason)) {
    return {
      ok: false,
      status: 400,
      error: "reason is required when found is false"
    };
  }

  const { data: message, error: msgError } = await admin
    .from("luna_messages")
    .select("id, conversation_id, role")
    .eq("id", messageId)
    .maybeSingle();

  if (msgError) {
    console.error("[luna/answer-found] select message", msgError);
    return { ok: false, status: 500, error: msgError.message };
  }
  if (!message) {
    return { ok: false, status: 404, error: "Not found" };
  }
  if (message.role !== "assistant") {
    return {
      ok: false,
      status: 400,
      error: "Only assistant messages can be rated"
    };
  }

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id")
    .eq("id", message.conversation_id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/answer-found] conversation", convError);
    return { ok: false, status: 500, error: convError.message };
  }
  if (!conversation) {
    return { ok: false, status: 404, error: "Not found" };
  }

  const isOwner = conversation.user_id === user.id;
  if (!isOwner && !(await isSuperAdminUser(admin, user))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const reason = opts.found ? null : (opts.reason as FoundReason);
  const row = {
    message_id: messageId,
    user_id: user.id,
    found: opts.found,
    reason,
    created_at: new Date().toISOString()
  };

  const { data: saved, error: upsertError } = await admin
    .from("luna_answer_found")
    .upsert(row, { onConflict: "message_id,user_id" })
    .select("found, reason")
    .maybeSingle();

  if (upsertError) {
    console.error("[luna/answer-found] upsert", upsertError);
    return { ok: false, status: 500, error: upsertError.message };
  }
  if (!saved) {
    return { ok: false, status: 500, error: "Upsert did not persist" };
  }

  return {
    ok: true,
    found: saved.found === true,
    reason: isFoundReason(saved.reason) ? saved.reason : null
  };
}
