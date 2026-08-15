-- Allow partial (quality miss) and error (save/run failure) verdicts
alter table public.luna_eval_results drop constraint if exists luna_eval_results_verdict_check;
alter table public.luna_eval_results
  add constraint luna_eval_results_verdict_check
  check (verdict = any (array['pass'::text, 'fail'::text, 'partial'::text, 'error'::text]));
