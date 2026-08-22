-- luna_notion_embeddings + HNSW 제거 (제시만 · 실행하지 말 것)
--
-- 전제: 검색이 luna_notion_chunk_embeddings 만 쓰고
--       matchNotionBlockEmbeddings 폴백을 코드에서 제거한 뒤.
--
-- 현재(2026-08-22) 코드는 청크 결과가 3페이지 미만일 때
-- luna_match_notion_blocks → luna_notion_embeddings 폴백을 호출한다.
-- 그 경로를 끄기 전에는 DROP 하지 말 것.

begin;

drop function if exists public.luna_match_notion_blocks(vector, double precision, integer);

drop index if exists public.luna_notion_embeddings_hnsw;
drop index if exists public.luna_notion_embeddings_hnsw_idx;

drop table if exists public.luna_notion_embeddings;

commit;
