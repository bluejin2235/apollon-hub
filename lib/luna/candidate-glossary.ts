import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GLOSSARY_MIGRATION_HINT,
  isGlossaryCandidate,
  parseGlossaryMeta
} from "@/lib/luna/candidate-format";

export async function tryRegisterGlossaryFromCandidate(
  admin: SupabaseClient,
  userId: string,
  meta: Record<string, unknown> | null | undefined,
  content: string
): Promise<{ registered: boolean; term_id?: string; notice?: string }> {
  const draft = parseGlossaryMeta(meta, content);
  if (!draft.term_ko.trim()) {
    return { registered: false, notice: "용어명이 없어 용어사전 등록을 건너뛰었습니다." };
  }

  try {
    const { data: existing } = await admin
      .from("glossary_terms")
      .select("id")
      .eq("term_ko", draft.term_ko)
      .maybeSingle();

    if (existing?.id) {
      const { data: verRow } = await admin
        .from("glossary_versions")
        .select("version")
        .eq("term_id", existing.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (Number(verRow?.version) || 0) + 1;

      const { error: updateError } = await admin
        .from("glossary_terms")
        .update({
          term_en: draft.term_en || null,
          term_zh: draft.term_zh || null,
          definition: draft.definition,
          categories: draft.categories,
          synonyms: draft.synonyms,
          version: nextVersion,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
      if (updateError) throw updateError;

      await admin.from("glossary_versions").insert({
        term_id: existing.id,
        version: nextVersion,
        term_ko: draft.term_ko,
        term_en: draft.term_en || null,
        term_zh: draft.term_zh || null,
        definition: draft.definition,
        synonyms: draft.synonyms,
        editor_type: "human",
        edited_by: userId,
        change_note: "지식후보 확정"
      });

      return { registered: true, term_id: existing.id as string };
    }

    const { data: inserted, error: insertError } = await admin
      .from("glossary_terms")
      .insert({
        term_ko: draft.term_ko,
        term_en: draft.term_en || null,
        term_zh: draft.term_zh || null,
        categories: draft.categories,
        synonyms: draft.synonyms,
        definition: draft.definition,
        version: 1,
        created_by: userId,
        updated_by: userId
      })
      .select("id")
      .maybeSingle();

    if (insertError) throw insertError;
    if (!inserted?.id) {
      return { registered: false, notice: "용어사전 등록에 실패했습니다." };
    }

    await admin.from("glossary_versions").insert({
      term_id: inserted.id,
      version: 1,
      term_ko: draft.term_ko,
      term_en: draft.term_en || null,
      term_zh: draft.term_zh || null,
      definition: draft.definition,
      synonyms: draft.synonyms,
      editor_type: "human",
      edited_by: userId,
      change_note: "지식후보 확정"
    });

    return { registered: true, term_id: inserted.id as string };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      message.includes("glossary_terms") ||
      message.includes("does not exist") ||
      message.includes("relation");
    return {
      registered: false,
      notice: missing ? GLOSSARY_MIGRATION_HINT : message
    };
  }
}

export function shouldRegisterGlossary(
  meta: Record<string, unknown> | null | undefined,
  category?: string | null
): boolean {
  return isGlossaryCandidate(meta, category);
}
