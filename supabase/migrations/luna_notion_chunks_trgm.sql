-- 키워드 ILIKE IO 경합 완화 — trigram GIN (CONCURRENTLY · 트랜잭션 밖)
-- 용량 실측(1.4만 청크): heading 1.6MB + text 13MB ≈ +15MB
-- 적용은 luna_search_io_contention.sql 과 함께.

create extension if not exists pg_trgm;

-- create index concurrently if not exists luna_notion_chunks_heading_trgm
--   on public.luna_notion_chunks using gin (heading gin_trgm_ops);
-- create index concurrently if not exists luna_notion_chunks_text_trgm
--   on public.luna_notion_chunks using gin (text gin_trgm_ops);
