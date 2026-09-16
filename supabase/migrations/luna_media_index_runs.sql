-- 이미지 색인 실행 기록 (시작·종료·건수·비용). 이어받기·아침 리포트용.
begin;

create table if not exists public.luna_media_index_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'done', 'failed', 'interrupted')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  root text,
  model text,
  limit_n integer,
  candidate_total integer not null default 0,
  work_total integer not null default 0,
  indexed integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  vision_in integer not null default 0,
  vision_out integer not null default 0,
  cost_usd real not null default 0,
  last_path text,
  fail_reasons jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists luna_media_index_runs_started_idx
  on public.luna_media_index_runs (started_at desc);

create index if not exists luna_media_index_runs_status_idx
  on public.luna_media_index_runs (status, started_at desc);

alter table public.luna_media_index_runs enable row level security;

revoke all on public.luna_media_index_runs from anon, authenticated;
grant all on public.luna_media_index_runs to service_role;
grant select on public.luna_media_index_runs to authenticated;

drop policy if exists luna_media_index_runs_admin_select on public.luna_media_index_runs;
create policy luna_media_index_runs_admin_select
  on public.luna_media_index_runs
  for select
  to authenticated
  using (public.is_super_admin());

comment on table public.luna_media_index_runs is
  '회사 PC 이미지 색인 실행. mtime skip 으로 이어받기. 아침 리포트·luna_checks 가 읽는다.';

-- 약속 시각 04:00 → 01:00 (노션·2차·자습과 겹치지 않게)
update public.luna_checks
set
  promise_label = '매일 01:00 약속',
  meaning_when_stale =
    '작업 스케줄러가 안 돌면 이미지 검색이 늘지 않습니다. 제가 PC 스케줄러를 켤 수 없습니다.',
  updated_at = now()
where id = 'image_index';

commit;
