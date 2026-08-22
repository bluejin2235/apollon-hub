-- luna_media_index HNSW — 대량 색인 후 적용 (현재 142장은 순차 검색으로 충분)
-- 적용은 수동. 이 파일만 제시하고 자동 실행하지 않음.

CREATE INDEX IF NOT EXISTS luna_media_index_embedding_hnsw_idx
  ON public.luna_media_index
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON INDEX luna_media_index_embedding_hnsw_idx IS
  'luna_match_media RPC 가 ORDER BY embedding <=> query 를 쓸 때 가속.';
