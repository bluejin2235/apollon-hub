-- A discovered page is not proof that its body and search representation are ready.
alter table public.luna_notion_pages add column if not exists index_health jsonb;
alter table public.luna_notion_index_runs add column if not exists worker_token uuid;
alter table public.luna_notion_index_runs add column if not exists worker_until timestamptz;

create or replace function public.luna_claim_notion_worker(p_run uuid, p_token uuid)
returns boolean language sql security invoker set search_path = public as $$
  with claimed as (
    update public.luna_notion_index_runs set worker_token=p_token,
      worker_until=clock_timestamp()+interval '330 seconds'
    where id=p_run and status='running'
      and (worker_until is null or worker_until<clock_timestamp()) returning id
  ) select exists(select 1 from claimed);
$$;
create or replace function public.luna_release_notion_worker(p_run uuid, p_token uuid)
returns void language sql security invoker set search_path = public as $$
  update public.luna_notion_index_runs set worker_token=null,worker_until=null
  where id=p_run and worker_token=p_token;
$$;
create or replace function public.luna_notion_readiness()
returns jsonb language sql security invoker set search_path = public as $$
  select jsonb_build_object(
    'total',count(*),
    'ready',count(*) filter(where index_health->>'state'='ready' and index_health->>'version'='2'),
    'empty',count(*) filter(where index_health->>'state'='empty' and index_health->>'version'='2'),
    'failed',count(*) filter(where index_health->>'state'='failed'),
    'building',count(*) filter(where index_health->>'state'='building'),
    'unverified',count(*) filter(where index_health is null or coalesce(index_health->>'version','')<>'2')
  ) from public.luna_notion_pages where not archived;
$$;
revoke all on function public.luna_claim_notion_worker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.luna_release_notion_worker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.luna_notion_readiness() from public,anon,authenticated;
grant execute on function public.luna_claim_notion_worker(uuid,uuid) to service_role;
grant execute on function public.luna_release_notion_worker(uuid,uuid) to service_role;
grant execute on function public.luna_notion_readiness() to service_role;
