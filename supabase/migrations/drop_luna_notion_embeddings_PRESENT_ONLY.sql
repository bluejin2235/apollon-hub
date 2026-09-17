-- luna_notion_embeddings + HNSW 제거 (제시만 · 실행 전 확인)
--
-- 2026-09-17: 코드에서 matchNotionBlockEmbeddings 폴백 제거.
-- 타임아웃 0 · 프로브 blockFallback 0 → 테이블 408MB 삭제 가능.
-- 며칠 지켜본 뒤 이 SQL 을 실행한다. DROP 하면 대시보드 legacy 경고도 사라진다.

begin;

drop function if exists public.luna_match_notion_blocks(vector, double precision, integer);

drop index if exists public.luna_notion_embeddings_hnsw;
drop index if exists public.luna_notion_embeddings_hnsw_idx;

drop table if exists public.luna_notion_embeddings;

commit;
