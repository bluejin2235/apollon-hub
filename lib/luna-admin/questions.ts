import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/luna-admin/db";
import type { LunaQuestionRow } from "@/lib/luna-admin/types";

export type LunaQuestionStatus = "pending" | "answered" | "skipped";
export type { LunaQuestionRow };

export async function listQuestions(
  admin: SupabaseClient,
  opts?: { status?: LunaQuestionStatus; assignee?: string | null }
): Promise<LunaQuestionRow[]> {
  let q = admin
    .from("luna_questions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.assignee) q = q.eq("assignee", opts.assignee);
  const { data, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/questions]", error);
    return [];
  }
  return (data ?? []) as LunaQuestionRow[];
}

export async function countQuestions(
  admin: SupabaseClient,
  status: LunaQuestionStatus = "pending"
): Promise<number> {
  const { count, error } = await admin
    .from("luna_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/questions] count", error);
    return 0;
  }
  return count ?? 0;
}

export async function answerQuestion(
  admin: SupabaseClient,
  id: string,
  userId: string,
  answer: string,
  status: "answered" | "skipped"
): Promise<LunaQuestionRow | null> {
  const { data, error } = await admin
    .from("luna_questions")
    .update({
      answer,
      status,
      answered_by: userId,
      answered_at: new Date().toISOString()
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/questions] answer", error);
    return null;
  }
  return data as LunaQuestionRow | null;
}
