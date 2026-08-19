import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";
import {
  contentHash,
  createEmbedding,
  embeddingToSql,
  glossaryEmbedText,
  learningEmbedText,
  wikiSectionEmbedText
} from "@/lib/luna/embedding";
import type { WikiSection } from "@/lib/wiki/types";

function isMissingEmbeddingSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg = "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("luna_wiki_embeddings") ||
    msg.includes("embedding")
  );
}

export function scheduleEmbedding(task: () => Promise<unknown>): void {
  void task().catch((err) => console.error("[luna/embedding-store]", err));
}

export async function upsertWikiDocEmbeddings(
  admin: SupabaseClient,
  opts: {
    libraryId: string;
    docTitle: string;
    sections: WikiSection[];
  }
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;
  const keep = new Set(opts.sections.map((s) => s.id));

  for (const section of opts.sections) {
    const text = wikiSectionEmbedText({
      docTitle: opts.docTitle,
      sectionTitle: section.title,
      body: section.body
    });
    const hash = contentHash(text);
    const { data: existing } = await admin
      .from("luna_wiki_embeddings")
      .select("content_hash")
      .eq("library_id", opts.libraryId)
      .eq("section_id", section.id)
      .maybeSingle();
    if (existing?.content_hash === hash) {
      skipped += 1;
      continue;
    }
    const vector = await createEmbedding(text);
    if (!vector) continue;
    const { error } = await admin.from("luna_wiki_embeddings").upsert(
      {
        library_id: opts.libraryId,
        section_id: section.id,
        content_hash: hash,
        embedding: embeddingToSql(vector),
        updated_at: new Date().toISOString()
      },
      { onConflict: "library_id,section_id" }
    );
    if (error) {
      if (isMissingEmbeddingSchema(error)) return { upserted, skipped };
      console.error("[luna/embedding-store] wiki upsert", error);
      continue;
    }
    upserted += 1;
  }

  const { data: rows } = await admin
    .from("luna_wiki_embeddings")
    .select("section_id")
    .eq("library_id", opts.libraryId);
  const stale = (rows ?? [])
    .map((r) => String(r.section_id))
    .filter((id) => !keep.has(id));
  if (stale.length > 0) {
    await admin
      .from("luna_wiki_embeddings")
      .delete()
      .eq("library_id", opts.libraryId)
      .in("section_id", stale);
  }

  return { upserted, skipped };
}

export async function upsertWikiDocEmbeddingsBySlug(
  admin: SupabaseClient,
  slug: string
): Promise<void> {
  const { data, error } = await admin
    .from("luna_library")
    .select("id, title, sections")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data?.id) {
    if (error && !isMissingEmbeddingSchema(error)) {
      console.error("[luna/embedding-store] wiki load", error);
    }
    return;
  }
  const sections = Array.isArray(data.sections)
    ? (data.sections as WikiSection[])
    : [];
  await upsertWikiDocEmbeddings(admin, {
    libraryId: String(data.id),
    docTitle: String(data.title ?? slug),
    sections
  });
}

export async function upsertGlossaryEmbedding(
  admin: SupabaseClient,
  termId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("glossary_terms")
    .select("id, term_ko, term_en, synonyms, definition, embedding_hash")
    .eq("id", termId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingEmbeddingSchema(error)) {
      console.error("[luna/embedding-store] glossary load", error);
    }
    return false;
  }
  const text = glossaryEmbedText({
    term_ko: data.term_ko as string | null,
    term_en: data.term_en as string | null,
    synonyms: normalizeSynonyms(data.synonyms),
    definition: data.definition as string | null
  });
  if (!text.trim()) return false;
  const hash = contentHash(text);
  if (data.embedding_hash === hash) return true;
  const vector = await createEmbedding(text);
  if (!vector) return false;
  const { error: upErr } = await admin
    .from("glossary_terms")
    .update({
      embedding: embeddingToSql(vector),
      embedding_hash: hash,
      embedding_updated_at: new Date().toISOString()
    })
    .eq("id", termId);
  if (upErr) {
    if (!isMissingEmbeddingSchema(upErr)) {
      console.error("[luna/embedding-store] glossary upsert", upErr);
    }
    return false;
  }
  return true;
}

export async function upsertLearningEmbedding(
  admin: SupabaseClient,
  learningId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, status, category, embedding_hash")
    .eq("id", learningId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingEmbeddingSchema(error)) {
      console.error("[luna/embedding-store] learning load", error);
    }
    return false;
  }
  if (data.status !== "active" || data.category === "identity") {
    return true;
  }
  const text = learningEmbedText(String(data.content ?? ""));
  if (!text) return false;
  const hash = contentHash(text);
  if (data.embedding_hash === hash) return true;
  const vector = await createEmbedding(text);
  if (!vector) return false;
  const { error: upErr } = await admin
    .from("luna_learnings")
    .update({
      embedding: embeddingToSql(vector),
      embedding_hash: hash,
      embedding_updated_at: new Date().toISOString()
    })
    .eq("id", learningId);
  if (upErr) {
    if (!isMissingEmbeddingSchema(upErr)) {
      console.error("[luna/embedding-store] learning upsert", upErr);
    }
    return false;
  }
  return true;
}

export type EmbeddingBackfillResult = {
  wiki_upserted: number;
  wiki_skipped: number;
  glossary_upserted: number;
  glossary_skipped: number;
  learning_upserted: number;
  learning_skipped: number;
  schema_missing: boolean;
};

/** 누락·해시 불일치만 채운다. 밤 정리·최초 스크립트 공용. */
export async function backfillMissingEmbeddings(
  admin: SupabaseClient,
  opts?: { limitPerKind?: number }
): Promise<EmbeddingBackfillResult> {
  const limit = opts?.limitPerKind ?? 80;
  const result: EmbeddingBackfillResult = {
    wiki_upserted: 0,
    wiki_skipped: 0,
    glossary_upserted: 0,
    glossary_skipped: 0,
    learning_upserted: 0,
    learning_skipped: 0,
    schema_missing: false
  };

  const probe = await admin.from("luna_wiki_embeddings").select("library_id").limit(1);
  if (probe.error && isMissingEmbeddingSchema(probe.error)) {
    result.schema_missing = true;
    return result;
  }

  const { data: libs } = await admin
    .from("luna_library")
    .select("id, title, sections, is_active")
    .eq("is_active", true)
    .limit(200);
  for (const lib of libs ?? []) {
    if (result.wiki_upserted >= limit) break;
    const sections = Array.isArray(lib.sections) ? (lib.sections as WikiSection[]) : [];
    const r = await upsertWikiDocEmbeddings(admin, {
      libraryId: String(lib.id),
      docTitle: String(lib.title ?? ""),
      sections
    });
    result.wiki_upserted += r.upserted;
    result.wiki_skipped += r.skipped;
  }

  const { data: terms } = await admin
    .from("glossary_terms")
    .select("id, embedding_hash")
    .is("deleted_at", null)
    .limit(400);
  for (const term of terms ?? []) {
    if (result.glossary_upserted >= limit) break;
    const id = String(term.id);
    const before = term.embedding_hash;
    const ok = await upsertGlossaryEmbedding(admin, id);
    if (!ok) continue;
    const { data: after } = await admin
      .from("glossary_terms")
      .select("embedding_hash")
      .eq("id", id)
      .maybeSingle();
    if (after?.embedding_hash && after.embedding_hash !== before) {
      result.glossary_upserted += 1;
    } else {
      result.glossary_skipped += 1;
    }
  }

  const { data: learns } = await admin
    .from("luna_learnings")
    .select("id, embedding_hash")
    .eq("status", "active")
    .neq("category", "identity")
    .limit(300);
  for (const row of learns ?? []) {
    if (result.learning_upserted >= limit) break;
    const id = String(row.id);
    const before = row.embedding_hash;
    const ok = await upsertLearningEmbedding(admin, id);
    if (!ok) continue;
    const { data: after } = await admin
      .from("luna_learnings")
      .select("embedding_hash")
      .eq("id", id)
      .maybeSingle();
    if (after?.embedding_hash && after.embedding_hash !== before) {
      result.learning_upserted += 1;
    } else {
      result.learning_skipped += 1;
    }
  }

  return result;
}
