-- LUNA 관리자 — 2차 데이터 · 관점 · 질문 그릇
-- 제시만. 실행은 블루진이 한다.
-- luna_selfstudy_queue 는 건드리지 않는다.

begin;

-- ── luna_links : 2차 데이터 (원천에 없던 연결) ───────────────
create table if not exists public.luna_links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null check (
    from_type in ('project', 'notion_page', 'nas_path', 'image', 'term', 'wiki')
  ),
  from_id text not null,
  to_type text not null check (
    to_type in ('project', 'notion_page', 'nas_path', 'image', 'term', 'wiki')
  ),
  to_id text not null,
  kind text not null check (kind in ('same', 'belongs', 'follows')),
  confidence real not null default 0
    check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb,
  source text not null check (source in ('rule', 'llm', 'human')),
  status text not null default 'pending'
    check (status in ('active', 'pending', 'rejected')),
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz
);

create index if not exists luna_links_from_idx
  on public.luna_links (from_type, from_id);

create index if not exists luna_links_to_idx
  on public.luna_links (to_type, to_id);

create index if not exists luna_links_kind_idx
  on public.luna_links (kind);

create index if not exists luna_links_status_idx
  on public.luna_links (status);

alter table public.luna_links enable row level security;

grant all on public.luna_links to service_role;
grant select, insert, update, delete on public.luna_links to authenticated;

drop policy if exists luna_links_admin_all on public.luna_links;
create policy luna_links_admin_all
  on public.luna_links
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── luna_perspectives : 관점 ────────────────────────────────
create table if not exists public.luna_perspectives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null check (source in ('data', 'question', 'human')),
  hit_count int not null default 0,
  used_count int not null default 0,
  status text not null default 'active'
    check (status in ('active', 'dormant')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists luna_perspectives_status_idx
  on public.luna_perspectives (status);

create index if not exists luna_perspectives_name_idx
  on public.luna_perspectives (name);

alter table public.luna_perspectives enable row level security;

grant all on public.luna_perspectives to service_role;
grant select, insert, update, delete on public.luna_perspectives to authenticated;

drop policy if exists luna_perspectives_admin_all on public.luna_perspectives;
create policy luna_perspectives_admin_all
  on public.luna_perspectives
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── luna_questions : 루나가 묻는 것 ─────────────────────────
create table if not exists public.luna_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  why text not null default '',
  context jsonb not null default '{}'::jsonb,
  assignee uuid references public.profiles (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'skipped')),
  answer text,
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz,
  confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  link_id uuid references public.luna_links (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists luna_questions_status_idx
  on public.luna_questions (status, created_at desc);

create index if not exists luna_questions_assignee_idx
  on public.luna_questions (assignee, status);

create index if not exists luna_questions_link_idx
  on public.luna_questions (link_id);

alter table public.luna_questions enable row level security;

grant all on public.luna_questions to service_role;
grant select, insert, update, delete on public.luna_questions to authenticated;

drop policy if exists luna_questions_admin_all on public.luna_questions;
create policy luna_questions_admin_all
  on public.luna_questions
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
