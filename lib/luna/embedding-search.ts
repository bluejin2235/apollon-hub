import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMBEDDING_MIN_SIMILARITY,
  embeddingToSql,
  type MatchVia
} from "@/lib/luna/embedding";

export type WikiEmbeddingHit = {
  library_id: string;
  section_id: string;
  similarity: number;
};

export type IdEmbeddingHit = {
  id: string;
  similarity: number;
};

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg = "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("Could not find the function") ||
    msg.includes("does not exist")
  );
}

export async function matchWikiEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<WikiEmbeddingHit[]> {
  const { data, error } = await admin.rpc("luna_match_wiki_embeddings", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? EMBEDDING_MIN_SIMILARITY,
    match_count: opts?.limit ?? 24
  });
  if (error) {
    if (!isMissingRpc(error)) console.error("[luna/embedding-search] wiki", error);
    return [];
  }
  return (data ?? [])
    .map((row: Record<string, unknown>) => ({
      library_id: String(row.library_id ?? ""),
      section_id: String(row.section_id ?? ""),
      similarity: Number(row.similarity) || 0
    }))
    .filter((r: WikiEmbeddingHit) => r.library_id && r.section_id && r.similarity > 0);
}

export async function matchGlossaryEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<IdEmbeddingHit[]> {
  const { data, error } = await admin.rpc("luna_match_glossary_embeddings", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? EMBEDDING_MIN_SIMILARITY,
    match_count: opts?.limit ?? 12
  });
  if (error) {
    if (!isMissingRpc(error)) console.error("[luna/embedding-search] glossary", error);
    return [];
  }
  return (data ?? [])
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      similarity: Number(row.similarity) || 0
    }))
    .filter((r: IdEmbeddingHit) => r.id && r.similarity > 0);
}

export async function matchLearningEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<IdEmbeddingHit[]> {
  const { data, error } = await admin.rpc("luna_match_learning_embeddings", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: opts?.threshold ?? EMBEDDING_MIN_SIMILARITY,
    match_count: opts?.limit ?? 16
  });
  if (error) {
    if (!isMissingRpc(error)) console.error("[luna/embedding-search] learning", error);
    return [];
  }
  return (data ?? [])
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      similarity: Number(row.similarity) || 0
    }))
    .filter((r: IdEmbeddingHit) => r.id && r.similarity > 0);
}

export type SearchDebugRow = {
  key: string;
  title: string;
  keyword_score: number;
  embedding_score: number;
  final_score: number;
  match_via: MatchVia;
  selected: boolean;
};
