import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { reviewSameLinks } from "@/lib/luna-admin/links";
import { isMissingTableError } from "@/lib/luna-admin/db";
import {
  isRelatedToTopic,
  loadRecentUserMessages,
  questionTopicTokens,
  resolveQuestionTargetUserId,
  type QuestionTargetInput
} from "@/lib/luna/question-target";

export const ASK_PER_DAY_MAX = 3;
export const LATER_MUTE_MS = 24 * 60 * 60 * 1000;

export type AskQuestion = {
  id: string;
  question: string;
  context: string | null;
  options: string[] | null;
  category: string | null;
  source: string | null;
  kind: "same" | "other";
  created_at: string;
};

type QuestionRow = {
  id: string;
  question: string;
  context: unknown;
  options: unknown;
  category: string | null;
  source: string | null;
  status: string;
  target_user_id: string | null;
  link_id: string | null;
  created_at: string;
  answered_by: string | null;
  answered_at: string | null;
};

const QUESTION_SELECT =
  "id, question, context, options, category, source, status, target_user_id, link_id, created_at, answered_by, answered_at";

export function parseQuestionContext(raw: unknown): Record<string, unknown> {
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
  }
  return {};
}

function parseOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const opts = raw
    .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    .map((o) => o.trim());
  return opts.length > 0 ? opts : null;
}

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function kstDay(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function laterMap(ctx: Record<string, unknown>): Record<string, string> {
  const raw = ctx.later;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

function surfacedMap(ctx: Record<string, unknown>): Record<string, string> {
  const raw = ctx.surfaced;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

function isSameKind(row: QuestionRow, ctx: Record<string, unknown>): boolean {
  return asText(ctx.kind) === "same" || Boolean(row.link_id);
}

function whyLine(ctx: Record<string, unknown>): string {
  return asText(ctx.why);
}

function toAskQuestion(row: QuestionRow): AskQuestion {
  const ctx = parseQuestionContext(row.context);
  const why = whyLine(ctx);
  return {
    id: row.id,
    question: row.question,
    context: why || null,
    options: parseOptions(row.options),
    category: row.category,
    source: row.source,
    kind: isSameKind(row, ctx) ? "same" : "other",
    created_at: row.created_at
  };
}

function targetInput(row: QuestionRow): QuestionTargetInput {
  return {
    question: row.question,
    context: parseQuestionContext(row.context),
    category: row.category,
    source: row.source
  };
}

export function isConfirmSameAnswer(answer: string): boolean {
  return answer === "같아요" || answer === "같다";
}

export function isRejectSameAnswer(answer: string): boolean {
  return answer === "달라요" || answer === "다르다";
}

async function loadPendingRows(
  admin: SupabaseClient
): Promise<QuestionRow[]> {
  const { data, error } = await admin
    .from("luna_questions")
    .select(QUESTION_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[luna/question-ask] list", error);
    }
    return [];
  }
  return (data ?? []) as QuestionRow[];
}

function userMutedUntil(rows: QuestionRow[], userId: string): number {
  let latest = 0;
  for (const row of rows) {
    const ts = laterMap(parseQuestionContext(row.context))[userId];
    if (!ts) continue;
    const t = new Date(ts).getTime();
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}

function pendingAskedTodayCount(rows: QuestionRow[], userId: string): number {
  const today = kstDay();
  let n = 0;
  for (const row of rows) {
    const ctx = parseQuestionContext(row.context);
    const laterAt = laterMap(ctx)[userId];
    const surfacedAt = surfacedMap(ctx)[userId];
    const laterToday = laterAt ? kstDay(laterAt) === today : false;
    const surfacedToday = surfacedAt ? kstDay(surfacedAt) === today : false;
    if (laterToday || surfacedToday) n += 1;
  }
  return n;
}

async function answeredTodayCount(
  admin: SupabaseClient,
  userId: string
): Promise<number> {
  const today = kstDay();
  const start = `${today}T00:00:00+09:00`;
  const { count, error } = await admin
    .from("luna_questions")
    .select("id", { count: "exact", head: true })
    .eq("answered_by", userId)
    .gte("answered_at", start);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error("[luna/question-ask] answered today", error);
    }
    return 0;
  }
  return count ?? 0;
}

function visibleToUser(
  row: QuestionRow,
  userId: string,
  superAdminId: string | null
): boolean {
  const ctx = parseQuestionContext(row.context);
  if (laterMap(ctx)[userId]) return false;
  const target = row.target_user_id;
  if (!target) return true;
  if (target === userId) return true;
  if (superAdminId && target === superAdminId && userId === superAdminId) {
    return true;
  }
  return false;
}

async function resolveSuperAdminId(
  admin: SupabaseClient
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "슈퍼관리자")
    .limit(5);
  const rows = data ?? [];
  const hub = rows.find((r) => String(r.email ?? "").includes("hub@"));
  return String(hub?.id ?? rows[0]?.id ?? "") || null;
}

async function maybeRetarget(
  admin: SupabaseClient,
  rows: QuestionRow[],
  superAdminId: string | null
): Promise<QuestionRow[]> {
  const out = [...rows];
  const messages = await loadRecentUserMessages(admin);
  const convCache = new Map<string, string | null>();
  let updated = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (updated >= 8) break;
    const row = out[i]!;
    if (row.target_user_id && row.target_user_id !== superAdminId) continue;
    const resolved = await resolveQuestionTargetUserId(admin, targetInput(row), {
      messages,
      conversationUsers: convCache
    });
    if (!resolved.userId || resolved.userId === row.target_user_id) continue;
    const ctx = parseQuestionContext(row.context);
    const { error } = await admin
      .from("luna_questions")
      .update({
        target_user_id: resolved.userId,
        context: {
          ...ctx,
          target_kind: resolved.kind,
          target_reason: resolved.reason
        }
      })
      .eq("id", row.id)
      .eq("status", "pending");
    if (error) {
      console.error("[luna/question-ask] retarget", error);
      continue;
    }
    out[i] = { ...row, target_user_id: resolved.userId };
    updated += 1;
  }
  return out;
}

async function markSurfaced(
  admin: SupabaseClient,
  row: QuestionRow,
  userId: string
): Promise<void> {
  const ctx = parseQuestionContext(row.context);
  const surfaced = surfacedMap(ctx);
  if (surfaced[userId] && kstDay(surfaced[userId]) === kstDay()) return;
  const next = {
    ...ctx,
    surfaced: { ...surfaced, [userId]: new Date().toISOString() }
  };
  const { error } = await admin
    .from("luna_questions")
    .update({ context: next })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) console.error("[luna/question-ask] surfaced", error);
}

export type AskListResult = {
  questions: AskQuestion[];
  count: number;
  muted: boolean;
  daily_left: number;
};

export async function listAskQuestions(
  admin: SupabaseClient,
  userId: string,
  opts?: { limit?: number; haystack?: string | null; retarget?: boolean }
): Promise<AskListResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 3, ASK_PER_DAY_MAX));
  let rows = await loadPendingRows(admin);
  const superAdminId = await resolveSuperAdminId(admin);
  if (opts?.retarget !== false) {
    rows = await maybeRetarget(admin, rows, superAdminId);
  }

  const lastLater = userMutedUntil(rows, userId);
  const muted =
    lastLater > 0 && Date.now() - lastLater < LATER_MUTE_MS;
  if (muted) {
    return { questions: [], count: 0, muted: true, daily_left: 0 };
  }

  const used =
    pendingAskedTodayCount(rows, userId) +
    (await answeredTodayCount(admin, userId));
  const dailyLeft = Math.max(0, ASK_PER_DAY_MAX - used);
  if (dailyLeft <= 0) {
    return { questions: [], count: 0, muted: false, daily_left: 0 };
  }

  const haystack = asText(opts?.haystack);
  const visible = rows.filter((row) => visibleToUser(row, userId, superAdminId));
  const related = haystack
    ? visible.filter((row) =>
        isRelatedToTopic(questionTopicTokens(targetInput(row)), haystack)
      )
    : visible;

  const picked = related.slice(0, Math.min(limit, dailyLeft));
  if (haystack) {
    for (const row of picked) {
      await markSurfaced(admin, row, userId);
    }
  }

  const questions = picked.map(toAskQuestion);
  return {
    questions,
    count: related.length,
    muted: false,
    daily_left: dailyLeft
  };
}

export async function conversationHaystack(
  admin: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<string> {
  const { data: conv } = await admin
    .from("luna_conversations")
    .select("id, user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return "";
  const owner = asText(conv.user_id);
  if (owner && owner !== userId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (String(profile?.role ?? "").trim() !== "슈퍼관리자") return "";
  }
  const { data } = await admin
    .from("luna_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);
  return (data ?? [])
    .map((row) => asText((row as { content?: string }).content))
    .filter(Boolean)
    .reverse()
    .join("\n");
}

export async function snoozeQuestionForUser(
  admin: SupabaseClient,
  questionId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin
    .from("luna_questions")
    .select("id, context, status, target_user_id")
    .eq("id", questionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Not found" };
  if (data.status !== "pending") {
    return { ok: false, error: "Question is not pending" };
  }
  if (data.target_user_id && data.target_user_id !== userId) {
    return { ok: false, error: "Forbidden" };
  }
  const ctx = parseQuestionContext(data.context);
  const later = laterMap(ctx);
  const next = {
    ...ctx,
    later: { ...later, [userId]: new Date().toISOString() }
  };
  const { error: upd } = await admin
    .from("luna_questions")
    .update({ context: next })
    .eq("id", questionId)
    .eq("status", "pending");
  if (upd) return { ok: false, error: upd.message };
  return { ok: true };
}

export async function resolveLunaQuestionAnswer(opts: {
  admin: SupabaseClient;
  questionId: string;
  userId: string;
  answer: string;
}): Promise<{
  ok: boolean;
  error?: string;
  status?: number;
  row?: {
    id: string;
    link_id: string | null;
    question: string;
    context: Record<string, unknown>;
  };
}> {
  const { admin, questionId, userId, answer } = opts;
  const { data: qRow, error: qErr } = await admin
    .from("luna_questions")
    .select("id, question, context, status, target_user_id, link_id")
    .eq("id", questionId)
    .maybeSingle();
  if (qErr) return { ok: false, error: qErr.message, status: 500 };
  if (!qRow) return { ok: false, error: "Not found", status: 404 };
  if (qRow.status !== "pending") {
    return { ok: false, error: "Question is not pending", status: 400 };
  }
  if (qRow.target_user_id && qRow.target_user_id !== userId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const answeredAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("luna_questions")
    .update({
      status: "answered",
      answer,
      answered_by: userId,
      answered_at: answeredAt
    })
    .eq("id", questionId)
    .eq("status", "pending");
  if (updateErr) return { ok: false, error: updateErr.message, status: 500 };

  const linkId = asText(qRow.link_id) || asText(
    parseQuestionContext(qRow.context).link_id
  );
  if (linkId && (isConfirmSameAnswer(answer) || isRejectSameAnswer(answer))) {
    try {
      await reviewSameLinks(admin, userId, {
        action: isConfirmSameAnswer(answer) ? "confirm" : "reject",
        ids: [linkId]
      });
    } catch (err) {
      console.error("[luna/question-ask] links", err);
    }
  }

  return {
    ok: true,
    row: {
      id: qRow.id as string,
      link_id: linkId || null,
      question: qRow.question as string,
      context: parseQuestionContext(qRow.context)
    }
  };
}
