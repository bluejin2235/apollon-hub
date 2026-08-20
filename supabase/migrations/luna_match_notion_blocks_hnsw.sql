-- HNSW 사용: 거리 ORDER BY LIMIT 먼저, 임계값은 바깥에서 필터
CREATE OR REPLACE FUNCTION public.luna_match_notion_blocks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.35,
  match_count integer DEFAULT 24
)
RETURNS TABLE(block_id text, page_id text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT sub.block_id, sub.page_id, sub.similarity
  FROM (
    SELECT
      e.block_id,
      e.page_id,
      (1 - (e.embedding <=> query_embedding))::double precision AS similarity
    FROM public.luna_notion_embeddings e
    ORDER BY e.embedding <=> query_embedding
    LIMIT greatest(match_count * 4, 48)
  ) sub
  WHERE sub.similarity >= match_threshold
  ORDER BY sub.similarity DESC
  LIMIT greatest(match_count, 1);
$$;
