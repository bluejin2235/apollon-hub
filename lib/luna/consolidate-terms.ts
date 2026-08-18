import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJsonObject } from "@/lib/luna/candidates";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import { lunaNotify } from "@/lib/luna/notify";

const SPLIT_SYSTEM = `당신은 아폴론 기억을 정리하는 편집자입니다.
용어사전이 우선이고, 아폴론 지식은 그 위에 쌓입니다.

오늘(또는 최근) 새로 생긴 용어 정의를 보고, 그 뜻을 그대로 품고 있는 아폴론 지식을 찾으세요.
- 정의("X는 무엇인가": 뜻·구성·범위)는 용어사전에 두고
- 지식에는 판단만 남깁니다 ("우리는 어떻게 하는가": 기준·방식·사례)

단순한 건 자동, 애매한 것만 사람에게 맡깁니다.

JSON만:
{
  "auto": [
    {
      "knowledge_id": "지식 id",
      "term_ko": "용어명",
      "new_content": "판단만 남긴 한 문장. 정의만 있던 지식이면 빈 문자열",
      "reason": "왜 단순한지"
    }
  ],
  "ask": [
    {
      "knowledge_id": "지식 id",
      "term_ko": "용어명",
      "reason": "왜 애매한지"
    }
  ]
}

규칙:
- 확신이 없으면 ask.
- 지식 문장이 정의와 거의 같고 판단이 없으면 new_content 를 빈 문자열로.
- 설명 문장 없이 JSON만.`;

export type TermSplitResult = {
  new_terms: number;
  auto: number;
  ask: number;
  error?: string;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function splitDefinitionFromKnowledge(
  admin: SupabaseClient
): Promise<TermSplitResult> {
  let termQuery = await admin
    .from("glossary_terms")
    .select("id, term_ko, definition, created_at")
    .gte("created_at", daysAgoIso(1))
    .is("deleted_at", null)
    .limit(40);
  if (termQuery.error) {
    termQuery = await admin
      .from("glossary_terms")
      .select("id, term_ko, definition, created_at")
      .gte("created_at", daysAgoIso(1))
      .limit(40);
  }
  if (termQuery.error) {
    console.error("[luna/consolidate] new terms", termQuery.error);
    return { new_terms: 0, auto: 0, ask: 0, error: termQuery.error.message };
  }

  const terms = (termQuery.data ?? []).filter(
    (t) =>
      typeof t.term_ko === "string" &&
      t.term_ko.trim() &&
      typeof t.definition === "string" &&
      t.definition.trim()
  );
  if (terms.length === 0) {
    return { new_terms: 0, auto: 0, ask: 0 };
  }

  const { data: actives, error: activeError } = await admin
    .from("luna_learnings")
    .select("id, content, category")
    .eq("status", "active")
    .neq("category", "identity")
    .neq("category", "term")
    .limit(200);
  if (activeError) {
    console.error("[luna/consolidate] split actives", activeError);
    return {
      new_terms: terms.length,
      auto: 0,
      ask: 0,
      error: activeError.message
    };
  }
  const knowledge = (actives ?? []).filter(
    (r) => typeof r.content === "string" && r.content.trim()
  );
  if (knowledge.length === 0) {
    return { new_terms: terms.length, auto: 0, ask: 0 };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const res = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "consolidate",
      system: SPLIT_SYSTEM,
      user: `새 용어:\n${JSON.stringify(
        terms.map((t) => ({
          id: t.id,
          term_ko: t.term_ko,
          definition: t.definition
        })),
        null,
        2
      )}\n\n아폴론 지식:\n${JSON.stringify(
        knowledge.map((k) => ({ id: k.id, content: k.content })),
        null,
        2
      )}`,
      maxTokens: 2048
    });
    parsed = parseJsonObject(res.text.trim());
  } catch (err) {
    console.error("[luna/consolidate] term split llm", err);
    return {
      new_terms: terms.length,
      auto: 0,
      ask: 0,
      error: err instanceof Error ? err.message : "llm failed"
    };
  }
  if (!parsed) {
    return { new_terms: terms.length, auto: 0, ask: 0, error: "parse failed" };
  }

  const knownIds = new Set(knowledge.map((k) => k.id as string));
  const claimed = new Set<string>();
  let auto = 0;
  let ask = 0;

  const autoRaw = Array.isArray(parsed.auto) ? parsed.auto : [];
  for (const item of autoRaw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.knowledge_id === "string" ? obj.knowledge_id.trim() : "";
    if (!id || !knownIds.has(id) || claimed.has(id)) continue;
    const next =
      typeof obj.new_content === "string" ? obj.new_content.trim() : "";
    const termKo = typeof obj.term_ko === "string" ? obj.term_ko.trim() : "";
    const row = knowledge.find((k) => k.id === id);
    const prev = typeof row?.content === "string" ? row.content : "";
    claimed.add(id);
    if (!next) {
      const { error } = await admin
        .from("luna_learnings")
        .update({
          status: "archived",
          review_reason: "term_split",
          resolved_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "active");
      if (error) {
        console.error("[luna/consolidate] archive def-only", error);
        continue;
      }
      auto += 1;
      continue;
    }
    if (next === prev) continue;
    const { error } = await admin
      .from("luna_learnings")
      .update({ content: next })
      .eq("id", id)
      .eq("status", "active");
    if (error) {
      console.error("[luna/consolidate] strip definition", error);
      continue;
    }
    const { data: ver } = await admin
      .from("luna_learning_versions")
      .select("version")
      .eq("learning_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVer = (typeof ver?.version === "number" ? ver.version : 0) + 1;
    await admin.from("luna_learning_versions").insert({
      learning_id: id,
      version: nextVer,
      content: prev,
      status: "active",
      change_note: `정의는 용어사전으로, 지식엔 판단만${termKo ? ` (${termKo})` : ""}`,
      editor_name: "루나"
    });
    auto += 1;
  }

  const askRaw = Array.isArray(parsed.ask) ? parsed.ask : [];
  for (const item of askRaw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.knowledge_id === "string" ? obj.knowledge_id.trim() : "";
    if (!id || !knownIds.has(id) || claimed.has(id)) continue;
    const termKo = typeof obj.term_ko === "string" ? obj.term_ko.trim() : "";
    const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
    claimed.add(id);
    const { data: current } = await admin
      .from("luna_learnings")
      .select("meta")
      .eq("id", id)
      .maybeSingle();
    const prevMeta =
      current?.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
        ? (current.meta as Record<string, unknown>)
        : {};
    const { error } = await admin
      .from("luna_learnings")
      .update({
        status: "candidate",
        review_reason: "term_split",
        origin: "direct",
        meta: {
          ...prevMeta,
          term_split: { term_ko: termKo, reason }
        }
      })
      .eq("id", id)
      .eq("status", "active");
    if (error) {
      console.error("[luna/consolidate] ask term_split", error);
      continue;
    }
    ask += 1;
  }

  if (auto > 0 || ask > 0) {
    await lunaNotify(
      admin,
      "consolidation",
      auto > 0 && ask === 0
        ? `정의 정리 — 자동 ${auto}건`
        : `정의 정리 — 자동 ${auto}건 · 확인 ${ask}건`,
      "새 용어 정의를 아폴론 지식에서 갈라 담았습니다.",
      { level: "info" }
    );
  }

  return { new_terms: terms.length, auto, ask };
}
