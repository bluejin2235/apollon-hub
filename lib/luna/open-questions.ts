import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpenQuestionRow } from "@/lib/luna/open-questions-shared";

export type { OpenQuestionRow } from "@/lib/luna/open-questions-shared";

export async function upsertOpenQuestion(
  admin: SupabaseClient,
  opts: {
    title: string;
    why: string;
    preview: string;
    bumpRelated?: number;
  }
): Promise<void> {
  const title = opts.title.trim().slice(0, 120);
  if (!title) return;

  const { data: existing } = await admin
    .from("luna_open_questions")
    .select("id, related_count")
    .eq("title", title)
    .eq("status", "open")
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing?.id) {
    await admin
      .from("luna_open_questions")
      .update({
        why: opts.why.trim().slice(0, 200) || undefined,
        preview: opts.preview.trim().slice(0, 200) || undefined,
        related_count:
          (typeof existing.related_count === "number"
            ? existing.related_count
            : 0) + (opts.bumpRelated ?? 1),
        updated_at: now
      })
      .eq("id", existing.id);
    return;
  }

  await admin.from("luna_open_questions").insert({
    title,
    why: opts.why.trim().slice(0, 200),
    preview: opts.preview.trim().slice(0, 200),
    related_count: opts.bumpRelated ?? 1,
    status: "open",
    created_at: now,
    updated_at: now
  });
}

export async function listOpenQuestions(
  admin: SupabaseClient,
  opts?: { limit?: number }
): Promise<OpenQuestionRow[]> {
  const { data, error } = await admin
    .from("luna_open_questions")
    .select(
      "id, title, why, preview, related_count, status, created_at, updated_at"
    )
    .eq("status", "open")
    .order("related_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 40);
  if (error) {
    console.error("[luna/open-questions] list", error);
    return [];
  }
  return (data ?? []) as OpenQuestionRow[];
}

export async function countOpenQuestions(
  admin: SupabaseClient
): Promise<number> {
  const { count, error } = await admin
    .from("luna_open_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}

/** 지난주 대비 증감 — 성장 지표 */
export async function openQuestionWeekDelta(
  admin: SupabaseClient
): Promise<{ open: number; delta: number }> {
  const open = await countOpenQuestions(admin);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: resolvedWeek } = await admin
    .from("luna_open_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "resolved")
    .gte("resolved_at", weekAgo);
  const { count: createdWeek } = await admin
    .from("luna_open_questions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", weekAgo);
  // 지난주보다 줄었으면 양수 성장
  const delta = (resolvedWeek ?? 0) - (createdWeek ?? 0);
  return { open, delta };
}

export async function resolveOpenQuestion(
  admin: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await admin
    .from("luna_open_questions")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  return !error;
}
