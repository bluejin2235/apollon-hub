import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import { getPrompt } from "@/lib/luna/prompts";

const MERGE_FALLBACK = `당신은 팀 지식을 통합하는 편집자입니다.
후보 지식 목록을 보고 중복은 하나로 합치고, 서로 모순되면 충돌로 표시하고, 가치가 없으면 discard에 넣으세요.
아래 JSON만 응답하세요:
{
  "merged": [{ "content": "통합된 문장", "category": "...", "source_ids": ["..."], "confidence": 3 }],
  "conflicts": [{ "content": "무엇과 무엇이 충돌하는지 설명", "source_ids": ["..."] }],
  "discard": ["버릴 후보 id"]
}`;

const ALLOWED_CATEGORIES = new Set([
  "preference",
  "client",
  "project",
  "style",
  "general"
]);

type CandidateRow = {
  id: string;
  category: string;
  content: string;
  author_id: string | null;
};

export type KnowledgeMergeResult = {
  merged: number;
  conflicts: number;
  archived: number;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
}

export async function runKnowledgeMerge(
  admin: SupabaseClient
): Promise<KnowledgeMergeResult> {
  const { data: candidates, error: candError } = await admin
    .from("luna_learnings")
    .select("id, category, content, author_id")
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: true })
    .limit(100);

  if (candError) {
    throw new Error(candError.message);
  }

  const rows = (candidates ?? []) as CandidateRow[];
  if (rows.length === 0) {
    return { merged: 0, conflicts: 0, archived: 0 };
  }

  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

  const tierC = resolveAnthropicModel(await getTierModel(admin, "C"));
  const mergePrompt =
    (await getPrompt(admin, "knowledge.merge")).trim() || MERGE_FALLBACK;

  const inputList = rows.map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    author_id: r.author_id
  }));

  const response = await client.messages.create({
    model: tierC.model_id,
    max_tokens: 4096,
    system: mergePrompt,
    messages: [
      {
        role: "user",
        content: `다음 후보 지식을 통합하세요.\n\n${JSON.stringify(inputList, null, 2)}`
      }
    ]
  });

  const rawText =
    response.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    throw new Error("Failed to parse merge model response");
  }

  const candidateIds = new Set(rows.map((r) => r.id));
  const toArchive = new Set<string>();

  const mergedRaw = Array.isArray(parsed.merged) ? parsed.merged : [];
  const conflictsRaw = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  const discardIds = asIdList(parsed.discard).filter((id) => candidateIds.has(id));

  let mergedCount = 0;
  let conflictCount = 0;

  for (const item of mergedRaw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) continue;
    const categoryRaw =
      typeof obj.category === "string" ? obj.category.trim() : "general";
    const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : "general";
    const sourceIds = asIdList(obj.source_ids).filter((id) => candidateIds.has(id));
    const confidenceRaw =
      typeof obj.confidence === "number" ? Math.round(obj.confidence) : 3;
    const confidence = Math.min(5, Math.max(1, confidenceRaw));

    const { error: insertError } = await admin.from("luna_learnings").insert({
      content,
      category,
      status: "active",
      confidence,
      merged_from: sourceIds,
      importance: confidence,
      use_count: 0
    });
    if (insertError) {
      console.error("[luna/knowledge-merge] insert merged", insertError);
      continue;
    }
    mergedCount += 1;
    for (const id of sourceIds) toArchive.add(id);
  }

  for (const item of conflictsRaw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) continue;
    const sourceIds = asIdList(obj.source_ids).filter((id) => candidateIds.has(id));

    const { error: insertError } = await admin.from("luna_learnings").insert({
      content,
      category: "general",
      status: "conflict",
      merged_from: sourceIds,
      use_count: 0
    });
    if (insertError) {
      console.error("[luna/knowledge-merge] insert conflict", insertError);
      continue;
    }
    conflictCount += 1;
    for (const id of sourceIds) toArchive.add(id);
  }

  for (const id of discardIds) toArchive.add(id);

  const archiveList = Array.from(toArchive);
  if (archiveList.length > 0) {
    const { error: archiveError } = await admin
      .from("luna_learnings")
      .update({ status: "archived" })
      .in("id", archiveList)
      .eq("status", "candidate");
    if (archiveError) {
      console.error("[luna/knowledge-merge] archive", archiveError);
      throw new Error(archiveError.message);
    }
  }

  return {
    merged: mergedCount,
    conflicts: conflictCount,
    archived: archiveList.length
  };
}
