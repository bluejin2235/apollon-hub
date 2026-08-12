create type glossary_category as enum ('common','interior','hw');
create type editor_type       as enum ('human','luna');
create type candidate_status  as enum ('pending','approved','rejected');

create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  term_ko text not null, term_en text, term_zh text, term_zh_pron text,
  category glossary_category not null default 'common',
  definition text, version int not null default 1,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (term_ko, category)
);
create table public.glossary_versions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  version int not null,
  term_ko text, term_en text, term_zh text, term_zh_pron text, definition text,
  editor_type editor_type not null default 'human',
  edited_by uuid references auth.users(id), editor_name text, change_note text,
  created_at timestamptz not null default now()
);
create table public.glossary_candidates (
  id uuid primary key default gen_random_uuid(),
  term_ko text not null, term_en text, term_zh text, term_zh_pron text,
  category glossary_category not null default 'common',
  definition_draft text, source_note text, source_conversation_id uuid,
  status candidate_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz
);

create index on public.glossary_terms (category);
create index glossary_terms_search_idx on public.glossary_terms
  using gin (to_tsvector('simple',
    coalesce(term_ko,'')||' '||coalesce(term_en,'')||' '||coalesce(term_zh,'')||' '||coalesce(definition,'')));
create index on public.glossary_versions (term_id, version desc);
create index on public.glossary_candidates (status);

alter table public.glossary_terms      enable row level security;
alter table public.glossary_versions   enable row level security;
alter table public.glossary_candidates enable row level security;

create policy "terms_read"   on public.glossary_terms      for select using (auth.role()='authenticated');
create policy "terms_insert" on public.glossary_terms      for insert with check (auth.role()='authenticated');
create policy "terms_update" on public.glossary_terms      for update using (auth.role()='authenticated');
create policy "versions_read" on public.glossary_versions  for select using (auth.role()='authenticated');
create policy "cand_read"    on public.glossary_candidates for select using (auth.role()='authenticated');
create policy "cand_insert"  on public.glossary_candidates for insert with check (auth.role()='authenticated');
create policy "cand_update"  on public.glossary_candidates for update using (auth.role()='authenticated');
