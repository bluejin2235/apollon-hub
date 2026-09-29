alter table public.luna_eval_runs add column if not exists checkpoint jsonb;
alter table public.luna_eval_runs add column if not exists worker_token uuid;
alter table public.luna_eval_runs add column if not exists worker_until timestamptz;
create or replace function public.luna_claim_eval_worker(p_run uuid,p_token uuid)
returns boolean language sql security invoker set search_path=public as $$
 with claimed as (
  update public.luna_eval_runs set worker_token=p_token,worker_until=clock_timestamp()+interval '830 seconds'
  where id=p_run and status='running' and checkpoint is not null
    and (worker_until is null or worker_until<clock_timestamp()) returning id
 ) select exists(select 1 from claimed);
$$;
create or replace function public.luna_release_eval_worker(p_run uuid,p_token uuid)
returns void language sql security invoker set search_path=public as $$
 update public.luna_eval_runs set worker_token=null,worker_until=null where id=p_run and worker_token=p_token;
$$;
revoke all on function public.luna_claim_eval_worker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.luna_release_eval_worker(uuid,uuid) from public,anon,authenticated;
grant execute on function public.luna_claim_eval_worker(uuid,uuid) to service_role;
grant execute on function public.luna_release_eval_worker(uuid,uuid) to service_role;
