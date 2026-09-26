-- Durable, non-expiring single-worker gate. A crashed/uncertain paid request
-- needs operator reconciliation; time alone must never authorize repayment.
create table if not exists public.nas_embedding_worker_gate (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null,
  acquired_at timestamptz not null default now()
);
alter table public.nas_embedding_worker_gate enable row level security;
revoke all on public.nas_embedding_worker_gate from public, anon, authenticated;
grant select, insert, delete on public.nas_embedding_worker_gate to service_role;

create or replace function public.nas_embedding_acquire_worker(p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_owner is null then raise exception 'Worker owner required'; end if;
  insert into public.nas_embedding_worker_gate(singleton, owner_id)
  values (true, p_owner) on conflict (singleton) do nothing;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.nas_embedding_release_worker(p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_owner is null then raise exception 'Worker owner required'; end if;
  delete from public.nas_embedding_worker_gate where singleton and owner_id = p_owner;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.nas_embedding_acquire_worker(uuid) from public, anon, authenticated;
revoke all on function public.nas_embedding_release_worker(uuid) from public, anon, authenticated;
grant execute on function public.nas_embedding_acquire_worker(uuid) to service_role;
grant execute on function public.nas_embedding_release_worker(uuid) to service_role;
