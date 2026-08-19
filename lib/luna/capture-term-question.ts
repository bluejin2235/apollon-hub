import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createCandidate } from "@/lib/luna/candidates";
import {
  askedTermKeyFromMeta,
  draftDefinitionFromAnswer,
  glossaryHasFilledDefinition,
  parseTermMeaningQuestion
} from "@/lib/luna/term-question";

type GlossaryRow = {
  term_ko?: string | null;
  term_en?: string | null;
  synonyms?: unknown;
  definition?: string | null;
};

export async function captureTermMeaningQuestion(opts: {
  admin: SupabaseClient;
  userId: string;
  userName?: string | null;
  conversationId?: string | null;
  question: string;
  answer: string;
  classifiedTypes: string[];
  glossaryRows: GlossaryRow[];
}): Promise<{ id: string; asked_count: number; created: boolean } | null> {
  if (!opts.classifiedTypes.includes("know")) return null;
  const askedTerm = parseTermMeaningQuestion(opts.question);
  if (!askedTerm) return null;
  if (glossaryHasFilledDefinition(askedTerm, opts.glossaryRows)) return null;

  const draft = draftDefinitionFromAnswer(opts.answer);
  const askedKey = askedTermKeyFromMeta({ asked_term: askedTerm });

  const { data: existingRows, error } = await opts.admin
    .from("luna_learnings")
    .select("id, meta, content")
    .eq("status", "candidate")
    .eq("category", "term");
  if (error) {
    console.error("[luna/term-question] list candidates", error);
    return null;
  }

  const existing = (existingRows ?? []).find((row) => {
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null;
    return askedTermKeyFromMeta(meta, row.content as string | null) === askedKey;
  });

  if (existing) {
    const prevMeta =
      existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
        ? { ...(existing.meta as Record<string, unknown>) }
        : {};
    const prevCount = Number(prevMeta.asked_count);
    const asked_count = (Number.isFinite(prevCount) && prevCount > 0 ? prevCount : 1) + 1;
    const meta = {
      ...prevMeta,
      kind: "glossary",
      asked_term: askedTerm,
      asked_count,
      last_asked_at: new Date().toISOString(),
      last_asked_by: opts.userId
    };
    const { error: updErr } = await opts.admin
      .from("luna_learnings")
      .update({ meta })
      .eq("id", existing.id);
    if (updErr) {
      console.error("[luna/term-question] increment", updErr);
      return null;
    }
    return { id: existing.id as string, asked_count, created: false };
  }

  const meta: Record<string, unknown> = {
    kind: "glossary",
    asked_term: askedTerm,
    asked_count: 1,
    draft_definition: draft,
    term_ko: askedTerm,
    definition: draft,
    asked_by: opts.userId,
    asked_by_name: opts.userName ?? null,
    asked_at: new Date().toISOString()
  };

  const created = await createCandidate(opts.admin, {
    content: askedTerm,
    evidence: `질문: ${opts.question.trim()}`,
    category: "term",
    source: "chat",
    author_id: opts.userId,
    assigned_to: opts.userId,
    source_conversation_id: opts.conversationId ?? null,
    raw_input: opts.question.trim(),
    meta,
    scope_suggestion: "org"
  });
  if (!created) return null;
  return { id: created.id, asked_count: 1, created: true };
}
