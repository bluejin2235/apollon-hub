-- 검색 IO 경합 해소
-- 1) trigram GIN — 키워드 ILIKE 풀스캔 방지 (CONCURRENTLY 는 트랜잭션 밖)
-- 2) luna_match_* — enable_seqscan=off 로 HNSW 강제, statement_timeout 5s

create extension if not exists pg_trgm;

-- concurrently 인덱스는 아래를 SQL editor / execute_sql 로 따로 실행:
-- create index concurrently if not exists luna_notion_chunks_heading_trgm
--   on public.luna_notion_chunks using gin (heading gin_trgm_ops);
-- create index concurrently if not exists luna_notion_chunks_text_trgm
--   on public.luna_notion_chunks using gin (text gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.luna_match_notion_chunks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.30,
  match_count integer DEFAULT 24
)
RETURNS TABLE(chunk_id text, page_id text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
SET enable_seqscan = off
SET statement_timeout = '5s'
AS $$
  SELECT sub.chunk_id, sub.page_id, sub.similarity
  FROM (
    SELECT
      e.chunk_id,
      e.page_id,
      (1 - (e.embedding <=> query_embedding))::double precision AS similarity
    FROM public.luna_notion_chunk_embeddings e
    ORDER BY e.embedding <=> query_embedding
    LIMIT greatest(match_count * 4, 48)
  ) sub
  WHERE sub.similarity >= match_threshold
  ORDER BY sub.similarity DESC
  LIMIT greatest(match_count, 1);
$$;

CREATE OR REPLACE FUNCTION public.luna_match_notion_blocks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.35,
  match_count integer DEFAULT 24
)
RETURNS TABLE(block_id text, page_id text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
SET enable_seqscan = off
SET statement_timeout = '5s'
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
