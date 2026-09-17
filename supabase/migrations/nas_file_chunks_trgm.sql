-- Work 본문 플랜 A — trigram 키워드 (임베딩 없이)
-- CONCURRENTLY 는 트랜잭션 밖. 이미 있으면면 스킵.

create extension if not exists pg_trgm;

-- create index concurrently if not exists nas_file_chunks_content_trgm
--   on public.nas_file_chunks using gin (content gin_trgm_ops);

comment on column public.nas_file_chunks.embedding is
  '플랜 A: null 유지. 의미 검색 실패가 쌓이면 플랜 B(2024~)만 채운다.';
