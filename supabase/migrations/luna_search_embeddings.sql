-- 검색 임베딩 (pgvector). 실행은 블루진. 에이전트는 적용하지 않음.
-- 전제: create extension vector; (이미 0.8.0)

-- 위키 절 단위 임베딩
create table if not exists public.luna_wiki_embeddings (
  library_id uuid not null references public.luna_library (id) on delete cascade,
  section_id text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now(),
  primary key (library_id, section_id)
);

create index if not exists luna_wiki_embeddings_hnsw
  on public.luna_wiki_embeddings
  using hnsw (embedding vector_cosine_ops);

-- 용어사전
alter table public.glossary_terms
  add column if not exists embedding vector(1536);
alter table public.glossary_terms
  add column if not exists embedding_hash text;
alter table public.glossary_terms
  add column if not exists embedding_updated_at timestamptz;

create index if not exists glossary_terms_embedding_hnsw
  on public.glossary_terms
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null and deleted_at is null;

-- 아폴론 지식
alter table public.luna_learnings
  add column if not exists embedding vector(1536);
alter table public.luna_learnings
  add column if not exists embedding_hash text;
alter table public.luna_learnings
  add column if not exists embedding_updated_at timestamptz;

create index if not exists luna_learnings_embedding_hnsw
  on public.luna_learnings
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null and status = 'active';

-- 유사도 검색 RPC (코사인: 1 - <=>)
create or replace function public.luna_match_wiki_embeddings(
  query_embedding vector(1536),
  match_threshold double precision default 0.35,
  match_count integer default 24
)
returns table (
  library_id uuid,
  section_id text,
  similarity double precision
)
language sql
stable
as $$
  select
    e.library_id,
    e.section_id,
    (1 - (e.embedding <=> query_embedding))::double precision as similarity
  from public.luna_wiki_embeddings e
  where 1 - (e.embedding <=> query_embedding) >= match_threshold
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

create or replace function public.luna_match_glossary_embeddings(
  query_embedding vector(1536),
  match_threshold double precision default 0.35,
  match_count integer default 12
)
returns table (
  id uuid,
  similarity double precision
)
language sql
stable
as $$
  select
    t.id,
    (1 - (t.embedding <=> query_embedding))::double precision as similarity
  from public.glossary_terms t
  where t.embedding is not null
    and t.deleted_at is null
    and 1 - (t.embedding <=> query_embedding) >= match_threshold
  order by t.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

create or replace function public.luna_match_learning_embeddings(
  query_embedding vector(1536),
  match_threshold double precision default 0.35,
  match_count integer default 16
)
returns table (
  id uuid,
  similarity double precision
)
language sql
stable
as $$
  select
    l.id,
    (1 - (l.embedding <=> query_embedding))::double precision as similarity
  from public.luna_learnings l
  where l.embedding is not null
    and l.status = 'active'
    and l.category is distinct from 'identity'
    and 1 - (l.embedding <=> query_embedding) >= match_threshold
  order by l.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.luna_match_wiki_embeddings(vector, double precision, integer) to service_role;
grant execute on function public.luna_match_glossary_embeddings(vector, double precision, integer) to service_role;
grant execute on function public.luna_match_learning_embeddings(vector, double precision, integer) to service_role;
