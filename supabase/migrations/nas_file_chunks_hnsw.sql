-- Work 본문 청크 — 노션과 분리된 HNSW + match RPC
-- nas_file_chunks 는 이미 별도 테이블. 임베딩이 쌓인 뒤 HNSW 생성.
-- 지금은 with_emb=0 이라 인덱스는 빈 partial 로 준비만 한다.
-- CONCURRENTLY 는 트랜잭션 밖에서 실행.

-- create index concurrently if not exists nas_file_chunks_embedding_hnsw
--   on public.nas_file_chunks
--   using hnsw (embedding vector_cosine_ops)
--   where embedding is not null;

CREATE OR REPLACE FUNCTION public.luna_match_nas_chunks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.30,
  match_count integer DEFAULT 24
)
RETURNS TABLE(id uuid, path text, seq integer, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
-- 노션과 동일: vector TOAST → 플래너가 seq 를 고름. Work 64만 건에서도 필요.
SET enable_seqscan = off
SET statement_timeout = '5s'
AS $$
  SELECT sub.id, sub.path, sub.seq, sub.similarity
  FROM (
    SELECT
      c.id,
      c.path,
      c.seq,
      (1 - (c.embedding <=> query_embedding))::double precision AS similarity
    FROM public.nas_file_chunks c
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT greatest(match_count * 4, 48)
  ) sub
  WHERE sub.similarity >= match_threshold
  ORDER BY sub.similarity DESC
  LIMIT greatest(match_count, 1);
$$;

grant execute on function public.luna_match_nas_chunks(vector, double precision, integer)
  to service_role;
