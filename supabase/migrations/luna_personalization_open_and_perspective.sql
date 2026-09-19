-- 루나가 못 푼 질문 — 블루진 「질문 있어요」
begin;

create table if not exists public.luna_open_questions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  why text not null default '',
  preview text not null default '',
  related_count integer not null default 1,
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists luna_open_questions_title_open_uidx
  on public.luna_open_questions (title)
  where status = 'open';

create index if not exists luna_open_questions_status_idx
  on public.luna_open_questions (status, updated_at desc);

alter table public.luna_open_questions enable row level security;

revoke all on public.luna_open_questions from anon, authenticated;
grant select on public.luna_open_questions to authenticated;
grant all on public.luna_open_questions to service_role;

drop policy if exists luna_open_questions_admin_all on public.luna_open_questions;
create policy luna_open_questions_admin_all
  on public.luna_open_questions
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists luna_open_questions_select_admin on public.luna_open_questions;
create policy luna_open_questions_select_admin
  on public.luna_open_questions
  for select
  to authenticated
  using (public.is_super_admin());

-- 팀 관점 자동 반영 이력 (되돌리기용)
create table if not exists public.luna_perspective_changes (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid references public.luna_prompts (id) on delete set null,
  prompt_title text not null default '',
  before_content text not null default '',
  after_content text not null default '',
  pattern text not null,
  evidence_count integer not null default 0,
  evidence_user_ids uuid[] not null default '{}',
  status text not null default 'applied'
    check (status in ('applied', 'reverted')),
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);

create index if not exists luna_perspective_changes_created_idx
  on public.luna_perspective_changes (created_at desc);

alter table public.luna_perspective_changes enable row level security;

revoke all on public.luna_perspective_changes from anon, authenticated;
grant select on public.luna_perspective_changes to authenticated;
grant all on public.luna_perspective_changes to service_role;

drop policy if exists luna_perspective_changes_admin on public.luna_perspective_changes;
create policy luna_perspective_changes_admin
  on public.luna_perspective_changes
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
