-- 자습 자율 실행 기록
begin;

create table if not exists public.luna_study_runs (
  id uuid primary key default gen_random_uuid(),
  agenda text not null,
  why text not null default '',
  expected text not null default '',
  kind text not null,
  scope jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  outcome text
    check (outcome is null or outcome in ('improved', 'no_change', 'failed')),
  cost_usd real not null default 0,
  llm_calls integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists luna_study_runs_started_idx
  on public.luna_study_runs (started_at desc);

create index if not exists luna_study_runs_kind_outcome_idx
  on public.luna_study_runs (kind, outcome, started_at desc);

alter table public.luna_study_runs enable row level security;

grant all on public.luna_study_runs to service_role;
grant select on public.luna_study_runs to authenticated;

drop policy if exists luna_study_runs_admin_select on public.luna_study_runs;
create policy luna_study_runs_admin_select
  on public.luna_study_runs
  for select
  to authenticated
  using (public.is_super_admin());

-- 런타임 테이블 발견용 (자습 건강 점검 메타)
create or replace function public.luna_list_public_columns()
returns table(table_name text, column_name text, data_type text)
language sql
security definer
set search_path = public
as $$
  select c.table_name::text, c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name like 'luna_%'
  order by 1, 2;
$$;

grant execute on function public.luna_list_public_columns() to service_role;
grant execute on function public.luna_list_public_columns() to authenticated;

comment on table public.luna_study_runs is
  '자습 자율 아젠다 실행. 무엇을·왜·결과가 아침 리포트와 이력에 쓰인다.';

commit;
