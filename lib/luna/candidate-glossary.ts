import type { SupabaseClient } from "@supabase/supabase-js";
import type { GlossaryDupResult } from "@/lib/glossary/duplicate";
import {
  bumpGlossaryVersion,
  checkGlossaryDuplicate,
  insertGlossaryTerm,
  normalizeIncomingFields
} from "@/lib/glossary/duplicate-service";
import {
  GLOSSARY_MIGRATION_HINT,
  isGlossaryCandidate,
  parseGlossaryMeta
} from "@/lib/luna/candidate-format";

export type GlossaryRegisterResult = {
  registered: boolean;
  term_id?: string;
  notice?: string;
  conflict?: GlossaryDupResult & {
    incoming: ReturnType<typeof normalizeIncomingFields>;
  };
};

export async function tryRegisterGlossaryFromCandidate(
  admin: SupabaseClient,
  userId: string,
  meta: Record<string, unknown> | null | undefined,
  content: string,
  opts?: { allowDuplicateUpdate?: boolean; existingId?: string | null }
): Promise<GlossaryRegisterResult> {
  const draft = parseGlossaryMeta(meta, content);
  if (!draft.term_ko.trim()) {
    return { registered: false, notice: "용어명이 없어 용어사전 등록을 건너뛰었습니다." };
  }

  try {
    const incoming = normalizeIncomingFields(draft);
    const { data: profile } = await admin
      .from("profiles")
      .select("name")
      .eq("id", userId)
      .maybeSingle();
    const editorName = ((profile?.name as string) || "").trim() || null;

    if (opts?.existingId) {
      const updated = await bumpGlossaryVersion(admin, {
        termId: opts.existingId,
        fields: incoming,
        userId,
        editorName,
        changeNote: "지식후보 확정 — 기존 뜻 갱신"
      });
      if ("error" in updated) {
        return { registered: false, notice: updated.error };
      }
      return { registered: true, term_id: updated.id };
    }

    const dup = await checkGlossaryDuplicate(admin, incoming, null);
    if (dup.conflicts) {
      if (!opts?.allowDuplicateUpdate) {
        return {
          registered: false,
          conflict: { ...dup, incoming }
        };
      }
    }

    const result = await insertGlossaryTerm(admin, {
      fields: incoming,
      userId,
      editorName,
      changeNote: "지식후보 확정"
    });
    if ("error" in result) {
      const message = result.error;
      if (message.includes("unique") || message.includes("duplicate")) {
        const again = await checkGlossaryDuplicate(admin, incoming, null);
        return {
          registered: false,
          conflict: { ...again, incoming },
          notice: message
        };
      }
      const missing =
        message.includes("glossary_terms") ||
        message.includes("does not exist") ||
        message.includes("relation");
      return {
        registered: false,
        notice: missing ? GLOSSARY_MIGRATION_HINT : message
      };
    }

    return { registered: true, term_id: result.id };
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
