import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "@/lib/luna/embedding";
import {
  matchGlossaryEmbeddings,
  matchLearningEmbeddings,
  matchWikiEmbeddings,
  type IdEmbeddingHit,
  type WikiEmbeddingHit
} from "@/lib/luna/embedding-search";

export type KnowledgeEmbeddingBundle = {
  queryEmbedding: number[] | null;
  wiki: WikiEmbeddingHit[];
  glossary: IdEmbeddingHit[];
  learning: IdEmbeddingHit[];
};

/** 질문 임베딩 1회 + 위키/용어/지식 유사도. 실패 시 빈 결과(키워드 폴백). */
export async function retrieveKnowledgeEmbeddings(
  admin: SupabaseClient,
  question: string,
  opts?: { timeoutMs?: number }
): Promise<KnowledgeEmbeddingBundle> {
  const empty: KnowledgeEmbeddingBundle = {
    queryEmbedding: null,
    wiki: [],
    glossary: [],
    learning: []
  };
  try {
    const queryEmbedding = await createQueryEmbedding(question, {
      timeoutMs: opts?.timeoutMs
    });
    if (!queryEmbedding) return empty;
    const [wiki, glossary, learning] = await Promise.all([
      matchWikiEmbeddings(admin, queryEmbedding),
      matchGlossaryEmbeddings(admin, queryEmbedding),
      matchLearningEmbeddings(admin, queryEmbedding)
    ]);
    return { queryEmbedding, wiki, glossary, learning };
  } catch (err) {
    console.error("[luna/embedding-retrieve]", err);
    return empty;
  }
}

/** 문서(라이브러리) 매칭용: 절 유사도 중 문서별 최댓값 */
export function maxSimilarityByLibrary(
  hits: WikiEmbeddingHit[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const hit of hits) {
    const prev = map.get(hit.library_id) ?? 0;
    if (hit.similarity > prev) map.set(hit.library_id, hit.similarity);
  }
  return map;
}
