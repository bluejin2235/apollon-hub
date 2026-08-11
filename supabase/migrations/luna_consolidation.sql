-- LUNA Phase 3: 정리(망각·통합) — 후보 생성만, 자동 확정/삭제 없음

-- 1) luna_learnings 컬럼
alter table public.luna_learnings
  add column if not exists merge_target uuid null
    references public.luna_learnings (id) on delete set null;

alter table public.luna_learnings
  add column if not exists review_reason text null;

comment on column public.luna_learnings.review_reason is
  'duplicate | stale | contradiction';

create index if not exists idx_luna_learnings_review_reason
  on public.luna_learnings (review_reason)
  where review_reason is not null;

create index if not exists idx_luna_learnings_merge_target
  on public.luna_learnings (merge_target)
  where merge_target is not null;

-- 2) 정리 실행 기록
create table if not exists public.luna_consolidation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  trigger text not null,
  scanned int null,
  merged_candidates int null,
  stale_candidates int null,
  conflict_candidates int null,
  status text not null default 'running',
  error text null,
  constraint luna_consolidation_runs_trigger_check
    check (trigger in ('volume', 'backstop', 'manual')),
  constraint luna_consolidation_runs_status_check
    check (status in ('running', 'done', 'failed'))
);

create index if not exists idx_luna_consolidation_runs_status_finished
  on public.luna_consolidation_runs (status, finished_at desc);

-- 3) 키-값 설정
create table if not exists public.luna_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.luna_settings (key, value) values
  ('consolidation_volume_threshold', '30'::jsonb),
  ('consolidation_backstop_days', '14'::jsonb),
  (
    'notify_events',
    '{"consolidation":true,"study":true,"reflect":true,"conflict":true,"prompt_change":true}'::jsonb
  )
on conflict (key) do nothing;
