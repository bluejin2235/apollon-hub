import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/luna-admin/db";
import type { LunaQuestionRow } from "@/lib/luna-admin/types";

export type LunaQuestionStatus = "pending" | "answered" | "skipped";
export type { LunaQuestionRow };

type RawQuestion = {
  id: string;
  question: string;
  context: unknown;
  status: string;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  target_user_id: string | null;
  created_at: string;
  source?: string | null;
};

function parseContext(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* plain */
      }
    }
    return { why: t };
  }
  return {};
}

function mapRow(row: RawQuestion): LunaQuestionRow {
  const ctx = parseContext(row.context);
  const why = typeof ctx.why === "string" ? ctx.why : "";
  const confidence =
    typeof ctx.confidence === "number" ? ctx.confidence : null;
  const linkId = typeof ctx.link_id === "string" ? ctx.link_id : null;
  return {
    id: row.id,
    question: row.question,
    why,
    context: ctx,
    assignee: row.target_user_id,
    status: (row.status as LunaQuestionRow["status"]) ?? "pending",
    answer: row.answer,
    answered_by: row.answered_by,
    answered_at: row.answered_at,
    confidence,
    link_id: linkId,
    created_at: row.created_at
  };
}

export async function listQuestions(
  admin: SupabaseClient,
  opts?: { status?: LunaQuestionStatus; assignee?: string | null }
): Promise<LunaQuestionRow[]> {
  let q = admin
    .from("luna_questions")
    .select(
      "id, question, context, status, answer, answered_by, answered_at, target_user_id, created_at, source"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.assignee) q = q.eq("target_user_id", opts.assignee);
  const { data, error } = await q;
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/questions]", error);
    return [];
  }
  return ((data ?? []) as RawQuestion[]).map(mapRow);
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
    .select(
      "id, question, context, status, answer, answered_by, answered_at, target_user_id, created_at, source"
    )
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) console.error("[luna-admin/questions] answer", error);
    return null;
  }
  return data ? mapRow(data as RawQuestion) : null;
}
