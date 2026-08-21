-- 노션 heading 단위 청크 + 청크 임베딩
-- 적용은 수동. 이 파일만 제시하고 자동 실행하지 않음.
--
-- 선택: 새 테이블 luna_notion_chunk_embeddings (block_id 컬럼 변경 아님)
-- 이유:
--   1) 기존 luna_notion_embeddings 는 재색인 전까지 검색이 살아 있다
--   2) 재색인 중에도 블록 검색으로 폴백 가능
--   3) 원본 luna_notion_blocks 와 임베딩 스키마를 분리해 롤백이 쉽다

create table if not exists public.luna_notion_chunks (
  chunk_id text primary key,
  page_id text not null,
  heading text not null default '',
  text text not null default '',
  block_ids jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  content_hash text not null,
  indexed_at timestamptz not null default now()
);

create index if not exists luna_notion_chunks_page_id_idx
  on public.luna_notion_chunks (page_id);

create index if not exists luna_notion_chunks_page_position_idx
  on public.luna_notion_chunks (page_id, position);

comment on table public.luna_notion_chunks is
  '노션 페이지를 heading(+본문) 단위로 묶은 검색 청크. 원본 블록은 luna_notion_blocks.';

create table if not exists public.luna_notion_chunk_embeddings (
  chunk_id text primary key references public.luna_notion_chunks(chunk_id) on delete cascade,
  page_id text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now()
);

create index if not exists luna_notion_chunk_embeddings_page_id_idx
  on public.luna_notion_chunk_embeddings (page_id);

-- HNSW (존재하지 않으면 생성; 이미 있으면 스킵하려면 수동 확인)
create index if not exists luna_notion_chunk_embeddings_hnsw_idx
  on public.luna_notion_chunk_embeddings
  using hnsw (embedding vector_cosine_ops);

comment on table public.luna_notion_chunk_embeddings is
  '청크 단위 임베딩. 검색은 luna_match_notion_chunks RPC 사용.';

CREATE OR REPLACE FUNCTION public.luna_match_notion_chunks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.35,
  match_count integer DEFAULT 24
)
RETURNS TABLE(chunk_id text, page_id text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
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
