-- 검색 IO · 플래너
--
-- ① trigram GIN — 키워드 ILIKE 풀스캔 방지 (CONCURRENTLY 는 트랜잭션 밖)
-- ② luna_match_notion_chunks — enable_seqscan=off 유지 이유:
--    vector(1536) 은 attstorage=EXTENDED → TOAST.
--    플래너 seq cost 는 힙 relpages(~3MB)만 보고 toast(~130MB)를 무시한다.
--    인라인 SQL 은 HNSW 를 쓰지만, RPC 함수 인자(Param) 경로에서는
--    seq scan 을 고른다 (ANALYZE 후에도 실측 ~20초·버퍼 15만+).
--    statistics_target / work_mem 으로는 안 고쳐진다. Work 64만 건에서도 동일.
-- ③ statement_timeout 5s — 빨리 포기

create extension if not exists pg_trgm;

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

-- 블록 폴백 RPC 는 코드에서 제거. 테이블 DROP 은 drop_luna_notion_embeddings_PRESENT_ONLY.sql
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
