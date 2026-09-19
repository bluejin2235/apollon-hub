import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lunaLlmComplete } from "@/lib/luna/llm/client";

/** 아폴론 팀 규모(부서당 2명)에 맞춤. 3명이면 영구 미발동. */
export const MIN_USERS = 2;

export type PerspectiveChangeRow = {
  id: string;
  prompt_id: string | null;
  prompt_title: string;
  before_content: string;
  after_content: string;
  pattern: string;
  evidence_count: number;
  evidence_user_ids: string[];
  status: string;
  created_at: string;
};

/**
 * 같은 패턴이 2명 이상 memo 에 있으면 팀 관점 프롬프트를 고친다.
 * 확인받지 않는다. 되돌리기는 이력으로.
 */
export async function promoteSharedMemoPatterns(
  admin: SupabaseClient
): Promise<{ checked: number; applied: number }> {
  const { data: memos, error } = await admin
    .from("luna_user_memories")
    .select("user_id, memo")
    .neq("memo", "")
    .limit(80);

  if (error || !memos?.length) {
    return { checked: 0, applied: 0 };
  }

  const lines = memos
    .map((m) => {
      const memo = typeof m.memo === "string" ? m.memo.trim() : "";
      if (!memo) return null;
      return `user:${m.user_id}\n${memo.slice(0, 500)}`;
    })
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 10_000);

  const patterns: Array<{
    pattern: string;
    line: string;
    user_ids: string[];
    perspective_hint: string;
  }> = [];

  try {
    const result = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "user_memory",
      system: `여러 사람의 개인 memo 를 보고, 2명 이상에게 같은 패턴이 있으면 팀 관점으로 올릴 후보를 JSON 으로 낸다.
출력: {"items":[{"pattern":"동선=관람 흐름","line":"「동선」을 관람 흐름으로 읽는다","user_ids":["uuid",...],"perspective_hint":"공간기획"}]}
없으면 {"items":[]}
개인 취향·답 길이·말버릇은 올리지 않는다. 팀 공통 해석만. 가능하면 같은 부서(perspective_hint) 사람들끼리만.`,
      user: lines,
      maxTokens: 600
    });
    const t = result.text.trim();
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      const obj = JSON.parse(t.slice(s, e + 1)) as {
        items?: Array<Record<string, unknown>>;
      };
      for (const it of obj.items ?? []) {
        const pattern = typeof it.pattern === "string" ? it.pattern.trim() : "";
        const line = typeof it.line === "string" ? it.line.trim() : "";
        const ids = Array.isArray(it.user_ids)
          ? it.user_ids.filter((x): x is string => typeof x === "string")
          : [];
        const hint =
          typeof it.perspective_hint === "string"
            ? it.perspective_hint.trim()
            : "";
        if (pattern && line && ids.length >= MIN_USERS) {
          patterns.push({
            pattern,
            line,
            user_ids: ids.slice(0, 12),
            perspective_hint: hint
          });
        }
      }
    }
  } catch (err) {
    console.error("[luna/perspective-promote] llm", err);
    return { checked: memos.length, applied: 0 };
  }

  let applied = 0;
  for (const p of patterns) {
    // 이미 같은 pattern 이 applied 면 skip
    const { data: prev } = await admin
      .from("luna_perspective_changes")
      .select("id")
      .eq("pattern", p.pattern)
      .eq("status", "applied")
      .maybeSingle();
    if (prev?.id) continue;

    let q = admin
      .from("luna_prompts")
      .select("id, title, content")
      .eq("kind", "perspective")
      .eq("is_active", true)
      .eq("level", "L2")
      .limit(8);
    if (p.perspective_hint) {
      q = q.ilike("title", `%${p.perspective_hint}%`);
    }
    const { data: prompts } = await q;
    const prompt = (prompts ?? [])[0];
    if (!prompt) continue;

    const before = typeof prompt.content === "string" ? prompt.content : "";
    if (before.includes(p.line)) continue;
    const after = `${before.trim()}\n\n· ${p.line}`.trim();

    const { error: upErr } = await admin
      .from("luna_prompts")
      .update({ content: after, updated_at: new Date().toISOString() })
      .eq("id", prompt.id);
    if (upErr) {
      console.error("[luna/perspective-promote] update", upErr);
      continue;
    }

    await admin.from("luna_perspective_changes").insert({
      prompt_id: prompt.id,
      prompt_title: prompt.title,
      before_content: before,
      after_content: after,
      pattern: p.pattern,
      evidence_count: p.user_ids.length,
      evidence_user_ids: p.user_ids,
      status: "applied"
    });
    applied += 1;
  }

  return { checked: memos.length, applied };
}

export async function revertPerspectiveChange(
  admin: SupabaseClient,
  changeId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: row, error } = await admin
    .from("luna_perspective_changes")
    .select("*")
    .eq("id", changeId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: "not_found" };
  if (row.status === "reverted") return { ok: true };
  if (row.prompt_id && typeof row.before_content === "string") {
    await admin
      .from("luna_prompts")
      .update({
        content: row.before_content,
        updated_at: new Date().toISOString()
      })
      .eq("id", row.prompt_id);
  }
  await admin
    .from("luna_perspective_changes")
    .update({
      status: "reverted",
      reverted_at: new Date().toISOString()
    })
    .eq("id", changeId);
  return { ok: true };
}

export async function listRecentPerspectiveChanges(
  admin: SupabaseClient,
  opts?: { limit?: number; sinceHours?: number }
): Promise<PerspectiveChangeRow[]> {
  let q = admin
    .from("luna_perspective_changes")
    .select(
      "id, prompt_id, prompt_title, before_content, after_content, pattern, evidence_count, evidence_user_ids, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 20);
  if (opts?.sinceHours) {
    const since = new Date(
      Date.now() - opts.sinceHours * 60 * 60 * 1000
    ).toISOString();
    q = q.gte("created_at", since);
  }
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as PerspectiveChangeRow[];
}
