import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCategories } from "@/lib/glossary/categories";
import {
  fallbackMergeDraft,
  findGlossaryDuplicates,
  mapGlossaryTermRow,
  type GlossaryDupResult,
  type GlossaryDupTerm
} from "@/lib/glossary/duplicate";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";
import type { GlossaryFieldValues } from "@/lib/glossary/types";
import { LUNA_MODEL } from "@/lib/luna/run-chat";

const TERM_SELECT =
  "id, term_ko, term_en, term_zh, categories, synonyms, definition, version, updated_at, updated_by";

export async function loadActiveGlossaryTerms(
  admin: SupabaseClient
): Promise<GlossaryDupTerm[]> {
  let q = await admin
    .from("glossary_terms")
    .select(TERM_SELECT)
    .is("deleted_at", null);
  if (q.error) {
    // deleted_at 없는 구스키마 폴백
    const retry = await admin.from("glossary_terms").select(TERM_SELECT);
    if (retry.error) {
      console.error("[glossary/dup] load terms", retry.error);
      return [];
    }
    q = retry;
  }

  const terms = (q.data ?? []).map((row) =>
    mapGlossaryTermRow(row as Record<string, unknown>)
  );

  const editorIds = Array.from(
    new Set(
      terms
        .map((t) => t.updated_by)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (editorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", editorIds);
    const nameMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      const name = ((p.name as string) || "").trim();
      if (name) nameMap.set(p.id as string, name);
    }
    for (const t of terms) {
      if (t.updated_by) t.updated_by_name = nameMap.get(t.updated_by) ?? null;
    }
  }
  return terms;
}

export async function checkGlossaryDuplicate(
  admin: SupabaseClient,
  incoming: GlossaryFieldValues,
  excludeId?: string | null
): Promise<GlossaryDupResult> {
  const terms = await loadActiveGlossaryTerms(admin);
  return findGlossaryDuplicates(incoming, terms, { excludeId });
}

export function normalizeIncomingFields(raw: {
  term_ko?: string | null;
  term_en?: string | null;
  term_zh?: string | null;
  definition?: string | null;
  categories?: unknown;
  category?: unknown;
  synonyms?: unknown;
}): GlossaryFieldValues {
  const rawKo = typeof raw.term_ko === "string" ? raw.term_ko.trim() : "";
  const rawEn = typeof raw.term_en === "string" ? raw.term_en.trim() : "";
  return {
    term_ko: rawKo || rawEn,
    term_en: rawEn,
    term_zh: typeof raw.term_zh === "string" ? raw.term_zh.trim() : "",
    definition: typeof raw.definition === "string" ? raw.definition.trim() : "",
    categories: normalizeCategories(raw.categories, raw.category),
    synonyms: normalizeSynonyms(raw.synonyms)
  };
}

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

/** 두 정의를 합친 병합 초안 — 루나(Claude). 실패 시 규칙 기반 폴백. */
export async function buildGlossaryMergeDraft(
  existing: GlossaryFieldValues,
  incoming: GlossaryFieldValues
): Promise<GlossaryFieldValues> {
  const fallback = fallbackMergeDraft(existing, incoming);
  const client = getAnthropicClient();
  if (!client) return fallback;

  try {
    const res = await client.messages.create({
      model: LUNA_MODEL,
      max_tokens: 2048,
      system: `당신은 용어사전 편집자입니다. 기존 용어와 새로 올린 용어를 하나로 합칩니다.
의미를 깎지 말고, 서로 다른 정보는 모두 남기세요.
아래 JSON만 출력하세요:
{
  "term_ko": "한국어 표제어",
  "term_en": "영문 또는 빈 문자열",
  "term_zh": "중문 또는 빈 문자열",
  "definition": "합친 정의",
  "categories": ["공통"],
  "synonyms": ["동의어"]
}`,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            { existing, incoming, hint: fallback },
            null,
            2
          )
        }
      ]
    });
    const raw =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const parsed = parseJsonObject(raw);
    if (!parsed) return fallback;
    return normalizeIncomingFields({
      term_ko:
        typeof parsed.term_ko === "string" ? parsed.term_ko : fallback.term_ko,
      term_en:
        typeof parsed.term_en === "string" ? parsed.term_en : fallback.term_en,
      term_zh:
        typeof parsed.term_zh === "string" ? parsed.term_zh : fallback.term_zh,
      definition:
        typeof parsed.definition === "string"
          ? parsed.definition
          : fallback.definition,
      categories: parsed.categories ?? fallback.categories,
      synonyms: parsed.synonyms ?? fallback.synonyms
    });
  } catch (err) {
    console.error("[glossary/merge-draft]", err);
    return fallback;
  }
}

export async function bumpGlossaryVersion(
  admin: SupabaseClient,
  args: {
    termId: string;
    fields: GlossaryFieldValues;
    userId: string;
    editorName: string | null;
    changeNote: string;
  }
): Promise<{ id: string; version: number } | { error: string }> {
  const { data: current, error: readError } = await admin
    .from("glossary_terms")
    .select("version")
    .eq("id", args.termId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError || !current) {
    return { error: readError?.message ?? "Not found" };
  }
  const nextVersion = (Number(current.version) || 1) + 1;
  const payload = {
    term_ko: args.fields.term_ko,
    term_en: args.fields.term_en || null,
    term_zh: args.fields.term_zh || null,
    categories: args.fields.categories,
    synonyms: args.fields.synonyms,
    definition: args.fields.definition || null,
    version: nextVersion,
    updated_by: args.userId,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await admin
    .from("glossary_terms")
    .update(payload)
    .eq("id", args.termId)
    .select("id, version")
    .maybeSingle();
  if (error || !data) {
    return { error: error?.message ?? "update failed" };
  }

  const { error: verErr } = await admin.from("glossary_versions").insert({
    term_id: args.termId,
    version: nextVersion,
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    definition: payload.definition,
    synonyms: payload.synonyms,
    editor_type: "human",
    editor_id: args.userId,
    editor_name: args.editorName,
    change_note: args.changeNote
  });
  if (verErr) {
    return { error: verErr.message };
  }
  return { id: data.id as string, version: nextVersion };
}

export async function insertGlossaryTerm(
  admin: SupabaseClient,
  args: {
    fields: GlossaryFieldValues;
    userId: string;
    editorName: string | null;
    changeNote: string;
  }
): Promise<{ id: string; version: number } | { error: string }> {
  const payload = {
    term_ko: args.fields.term_ko,
    term_en: args.fields.term_en || null,
    term_zh: args.fields.term_zh || null,
    categories: args.fields.categories,
    synonyms: args.fields.synonyms,
    definition: args.fields.definition || null,
    version: 1,
    created_by: args.userId,
    updated_by: args.userId
  };
  const { data, error } = await admin
    .from("glossary_terms")
    .insert(payload)
    .select("id, version")
    .maybeSingle();
  if (error || !data) {
    return { error: error?.message ?? "insert failed" };
  }
  const { error: verErr } = await admin.from("glossary_versions").insert({
    term_id: data.id,
    version: 1,
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    definition: payload.definition,
    synonyms: payload.synonyms,
    editor_type: "human",
    editor_id: args.userId,
    editor_name: args.editorName,
    change_note: args.changeNote
  });
  if (verErr) {
    return { error: verErr.message };
  }
  return { id: data.id as string, version: 1 };
}
