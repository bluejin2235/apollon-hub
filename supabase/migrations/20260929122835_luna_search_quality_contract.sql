-- Private labels stay in the existing RLS-protected evaluation tables, never in code.
alter table public.luna_eval_cases add column if not exists search_expectations jsonb;
alter table public.luna_eval_results add column if not exists search_quality jsonb;
alter table public.luna_eval_results add column if not exists execution_trace jsonb;
comment on column public.luna_eval_cases.search_expectations is 'Verified required/forbidden source IDs or expect_empty. Null means retrieval completeness is unmeasured.';
comment on column public.luna_eval_results.execution_trace is 'Production engine evidence trace and stream consistency check, without source bodies.';
