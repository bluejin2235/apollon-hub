-- 회귀 시험 2단 채점·티어 실행용 컬럼
alter table public.luna_eval_results
  add column if not exists score numeric null;

alter table public.luna_eval_results
  add column if not exists fail_kind text null;

alter table public.luna_eval_runs
  add column if not exists tier text null;

alter table public.luna_eval_runs
  add column if not exists score_sum numeric null;

alter table public.luna_eval_runs
  add column if not exists score_max numeric null;

comment on column public.luna_eval_results.score is '0 | 0.5 | 1 — must_pass 실패=0, 품질 미달=0.5, 합격=1';
comment on column public.luna_eval_results.fail_kind is 'must_pass | quality | null(합격)';
comment on column public.luna_eval_runs.tier is 'light | heavy | prompt | mixed';
