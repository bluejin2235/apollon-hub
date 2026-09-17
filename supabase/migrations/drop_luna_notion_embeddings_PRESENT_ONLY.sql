-- luna_notion_embeddings + HNSW 제거 (제시만 · 실행하지 말 것)
--
-- 전제: 검색이 luna_notion_chunk_embeddings 만 쓰고
--       matchNotionBlockEmbeddings 폴백을 코드에서 제거한 뒤.
--
-- 2026-09-17: 폴백을 다시 유지한다. 청크 RPC 실패·부족 시 블록 임베딩을 쓴다.
-- 이 SQL 은 폴백 사용이 사실상 사라진 뒤에야 실행한다.

begin;

drop function if exists public.luna_match_notion_blocks(vector, double precision, integer);

drop index if exists public.luna_notion_embeddings_hnsw;
drop index if exists public.luna_notion_embeddings_hnsw_idx;

drop table if exists public.luna_notion_embeddings;

commit;
