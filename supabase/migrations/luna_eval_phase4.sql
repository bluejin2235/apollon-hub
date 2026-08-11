-- LUNA Phase 4: 자동 시험 + 사람 채점 + 팀 마이크로 평가

-- 1) luna_eval_results 자동 채점 컬럼
alter table public.luna_eval_results
  add column if not exists answer text null;

alter table public.luna_eval_results
  add column if not exists auto_pass boolean null;

alter table public.luna_eval_results
  add column if not exists auto_reason text null;

-- 2) 사람 채점
create table if not exists public.luna_eval_human_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.luna_eval_results (id) on delete cascade,
  case_id uuid not null references public.luna_eval_cases (id) on delete cascade,
  scorer_id uuid not null references public.profiles (id) on delete cascade,
  score int not null,
  comment text null,
  created_at timestamptz not null default now(),
  constraint luna_eval_human_scores_score_check check (score between 1 and 10),
  constraint luna_eval_human_scores_unique unique (result_id, scorer_id)
);

create index if not exists idx_luna_eval_human_scores_case
  on public.luna_eval_human_scores (case_id);

create index if not exists idx_luna_eval_human_scores_result
  on public.luna_eval_human_scores (result_id);

-- 3) 마이크로 평가 배정
create table if not exists public.luna_eval_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  result_id uuid not null references public.luna_eval_results (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  answered_at timestamptz null,
  constraint luna_eval_daily_unique unique (user_id, result_id)
);

create index if not exists idx_luna_eval_daily_user_pending
  on public.luna_eval_daily (user_id, answered_at);

-- 4) 알림 이벤트 exam 키 (기본 true)
insert into public.luna_settings (key, value)
values (
  'notify_events',
  '{"consolidation":true,"study":true,"reflect":true,"conflict":true,"prompt_change":true,"exam":true}'::jsonb
)
on conflict (key) do update
set value = coalesce(public.luna_settings.value, '{}'::jsonb) || '{"exam":true}'::jsonb,
    updated_at = now()
where not (coalesce(public.luna_settings.value, '{}'::jsonb) ? 'exam');
