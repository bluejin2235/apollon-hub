-- 부정·긍정·정정 신호를 한곳에 모은다. 기존 테이블은 유지하고 이중 기록한다.
-- luna_link_rules 개념을 luna_rules 로 넓힌다.

begin;

create table if not exists public.luna_signals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('negative', 'positive', 'correction')),
  source text not null check (
    source in (
      'thumbs',
      'chat_correction',
      'link_reject',
      'question_answer',
      'search_zero',
      'followup'
    )
  ),
  subject_type text not null check (
    subject_type in ('answer', 'link', 'term', 'project', 'path', 'failure', 'question')
  ),
  subject_id text not null default '',
  reason text,
  note text,
  context jsonb not null default '{}'::jsonb,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists luna_signals_kind_idx
  on public.luna_signals (kind, created_at desc);

create index if not exists luna_signals_source_idx
  on public.luna_signals (source, created_at desc);

create index if not exists luna_signals_subject_idx
  on public.luna_signals (subject_type, subject_id);

create index if not exists luna_signals_reason_idx
  on public.luna_signals (reason)
  where reason is not null;

alter table public.luna_signals enable row level security;

grant all on public.luna_signals to service_role;
grant select, insert on public.luna_signals to authenticated;

drop policy if exists luna_signals_admin_all on public.luna_signals;
create policy luna_signals_admin_all
  on public.luna_signals
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists luna_signals_insert_own on public.luna_signals;
create policy luna_signals_insert_own
  on public.luna_signals
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_super_admin());

create table if not exists public.luna_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('link', 'search', 'answer', 'term')),
  pattern_type text not null check (pattern_type in ('stopword', 'rule', 'threshold')),
  pattern_value text not null,
  signal_count int not null default 0,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'dropped')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists luna_rules_unique_pattern
  on public.luna_rules (scope, pattern_type, pattern_value);

create index if not exists luna_rules_status_idx
  on public.luna_rules (status, created_at desc);

alter table public.luna_rules enable row level security;

grant all on public.luna_rules to service_role;
grant select, insert, update, delete on public.luna_rules to authenticated;

drop policy if exists luna_rules_admin_all on public.luna_rules;
create policy luna_rules_admin_all
  on public.luna_rules
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
