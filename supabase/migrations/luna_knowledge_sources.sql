-- LUNA 지식 원문 (luna_knowledge_sources) + learnings.source_id + 변경 이력
-- 원격에 sources/source_id 가 이미 있으면 환경을 위해 idempotent.

begin;

create table if not exists public.luna_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  source_type text not null default 'interview',
  spoken_by text null,
  spoken_at date null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_luna_knowledge_sources_type
  on public.luna_knowledge_sources (source_type, spoken_at desc);

create index if not exists idx_luna_knowledge_sources_spoken_at
  on public.luna_knowledge_sources (spoken_at desc nulls last);

alter table public.luna_learnings
  add column if not exists source_id uuid null
    references public.luna_knowledge_sources (id) on delete set null;

create index if not exists idx_luna_learnings_source_id
  on public.luna_learnings (source_id)
  where source_id is not null;

create table if not exists public.luna_learning_versions (
  id uuid primary key default gen_random_uuid(),
  learning_id uuid not null
    references public.luna_learnings (id) on delete cascade,
  version int not null,
  content text not null,
  status text null,
  change_note text null,
  edited_by uuid null references public.profiles (id) on delete set null,
  editor_name text null,
  created_at timestamptz not null default now(),
  unique (learning_id, version)
);

create index if not exists idx_luna_learning_versions_learning
  on public.luna_learning_versions (learning_id, version desc);

alter table public.luna_knowledge_sources enable row level security;
alter table public.luna_learning_versions enable row level security;

drop policy if exists "luna_knowledge_sources_read" on public.luna_knowledge_sources;
create policy "luna_knowledge_sources_read"
  on public.luna_knowledge_sources for select
  using (auth.role() = 'authenticated');

drop policy if exists "luna_knowledge_sources_admin" on public.luna_knowledge_sources;
create policy "luna_knowledge_sources_admin"
  on public.luna_knowledge_sources for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "luna_learning_versions_read" on public.luna_learning_versions;
create policy "luna_learning_versions_read"
  on public.luna_learning_versions for select
  using (auth.role() = 'authenticated');

drop policy if exists "luna_learning_versions_admin" on public.luna_learning_versions;
create policy "luna_learning_versions_admin"
  on public.luna_learning_versions for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select on public.luna_knowledge_sources to authenticated;
grant insert, update, delete on public.luna_knowledge_sources to authenticated;
grant select on public.luna_learning_versions to authenticated;
grant insert, update, delete on public.luna_learning_versions to authenticated;

commit;
