-- Work 본문 청크 키워드 검색 (pg_trgm). 임베딩 없이 고유명사·문구 검색.
-- CONCURRENTLY 는 트랜잭션 금지 — 이 파일은 수동/ MCP execute_sql 로 적용.

create extension if not exists pg_trgm;

create index concurrently if not exists nas_file_chunks_content_trgm
  on public.nas_file_chunks using gin (content gin_trgm_ops);

comment on index public.nas_file_chunks_content_trgm is
  'Work 본문 키워드(trigram). 노션 text_trgm 13MB/1.4만 ≈ 20만 청크 시 ~190MB.';
