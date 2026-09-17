-- luna_notion_embeddings + HNSW 제거 (제시만 · 실행하지 말 것)
--
-- 전제: 검색이 luna_notion_chunk_embeddings 만 쓰고
--       matchNotionBlockEmbeddings 폴백을 코드에서 제거한 뒤.
--
-- 2026-09-17: 코드 폴백 제거 완료. 며칠 지켜본 뒤 이 SQL 을 실행한다.
-- DROP 하면 대시보드 경고(legacy_embeddings)도 사라진다.

begin;

drop function if exists public.luna_match_notion_blocks(vector, double precision, integer);

drop index if exists public.luna_notion_embeddings_hnsw;
drop index if exists public.luna_notion_embeddings_hnsw_idx;

drop table if exists public.luna_notion_embeddings;

commit;
