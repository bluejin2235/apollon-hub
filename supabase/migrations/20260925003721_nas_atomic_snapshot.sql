begin;
create table public.nas_snapshot_runs (
  id uuid primary key,
  generation bigint generated always as identity unique,
  drive text not null check (drive ~ '^[A-Z]$'),
  started_at timestamptz not null default clock_timestamp(),
  committed_at timestamptz,
  committed_count integer
);
create index nas_snapshot_runs_drive_generation on public.nas_snapshot_runs(drive,generation desc);
create table public.nas_snapshot_stage (
  run_id uuid not null references public.nas_snapshot_runs(id) on delete cascade,
  path text not null,
  type text not null check (type in ('folder','file')),
  size_bytes bigint,
  modified_at timestamptz,
  file_summary text,
  primary key(run_id,path)
);
alter table public.nas_snapshot_runs enable row level security;
alter table public.nas_snapshot_stage enable row level security;
revoke all on public.nas_snapshot_runs, public.nas_snapshot_stage from public,anon,authenticated;
grant all on public.nas_snapshot_runs, public.nas_snapshot_stage to service_role;
grant usage,select on sequence public.nas_snapshot_runs_generation_seq to service_role;

-- Called BEFORE collection, with a client-generated id retained across retries.
create function public.nas_snapshot_begin(p_run_id uuid,p_drive text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing_drive text;
begin
  if p_run_id is null or p_drive is null or p_drive !~ '^[A-Z]$' then
    raise exception 'Invalid snapshot identity';
  end if;
  perform pg_advisory_xact_lock(78291,ascii(p_drive));
  insert into public.nas_snapshot_runs(id,drive) values(p_run_id,p_drive) on conflict(id) do nothing;
  select drive into existing_drive from public.nas_snapshot_runs where id=p_run_id;
  if existing_drive <> p_drive then raise exception 'Run belongs to another drive'; end if;
  -- Bound abandoned staging retention; retain run identities for retry ordering.
  delete from public.nas_snapshot_stage s using public.nas_snapshot_runs r
    where s.run_id=r.id and r.drive=p_drive and r.started_at < now()-interval '7 days';
  return p_run_id;
end;
$$;

create function public.nas_snapshot_stage_batch(p_run_id uuid,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.nas_snapshot_runs; n integer;
begin
  select * into r from public.nas_snapshot_runs where id=p_run_id for update;
  if not found or r.committed_at is not null then raise exception 'Run missing or already committed'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be an array'; end if;
  n:=jsonb_array_length(p_rows);
  if n<1 or n>100 then raise exception 'Batch must contain 1 to 100 rows'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) e where
    e->>'drive' is distinct from r.drive or coalesce(e->>'path','')='' or
    e->>'type' is null or e->>'type' not in ('folder','file')) then
    raise exception 'Invalid row or mismatched drive';
  end if;
  insert into public.nas_snapshot_stage(run_id,path,type,size_bytes,modified_at,file_summary)
    select p_run_id,x.path,x.type,x.size_bytes,x.modified_at,x.file_summary
    from jsonb_to_recordset(p_rows) as x(path text,type text,size_bytes bigint,modified_at timestamptz,file_summary text)
    on conflict(run_id,path) do update set type=excluded.type,size_bytes=excluded.size_bytes,
      modified_at=excluded.modified_at,file_summary=excluded.file_summary;
  return n;
end;
$$;

create function public.nas_snapshot_commit(p_run_id uuid,p_expected_count integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.nas_snapshot_runs; staged bigint; previous bigint;
begin
  select * into r from public.nas_snapshot_runs where id=p_run_id;
  if not found then raise exception 'Run missing'; end if;
  perform pg_advisory_xact_lock(78291,ascii(r.drive));
  select * into r from public.nas_snapshot_runs where id=p_run_id for update;
  if r.committed_at is not null then
    if p_expected_count is distinct from r.committed_count then raise exception 'Retry count differs'; end if;
    return r.committed_count;
  end if;
  if exists(select 1 from public.nas_snapshot_runs where drive=r.drive and generation>r.generation) then
    raise exception 'Superseded snapshot';
  end if;
  select count(*) into staged from public.nas_snapshot_stage where run_id=p_run_id;
  if p_expected_count is null or p_expected_count<1 or staged<>p_expected_count then
    raise exception 'Incomplete snapshot';
  end if;
  -- Serializes legacy writers too, while ordinary SELECT remains available.
  lock table public.nas_directory in share row exclusive mode;
  select count(*) into previous from public.nas_directory where drive=r.drive;
  if staged < (case when previous=0 then 100 else ceil(previous*0.7) end) then
    raise exception 'Snapshot below existing safety threshold';
  end if;
  -- Both statements and the receipt are one transaction: any error rolls all back.
  delete from public.nas_directory where drive=r.drive;
  insert into public.nas_directory(drive,path,type,size_bytes,modified_at,file_summary,scan_batch)
    select r.drive,path,type,size_bytes,modified_at,file_summary,r.started_at
    from public.nas_snapshot_stage where run_id=p_run_id;
  update public.nas_snapshot_runs set committed_at=clock_timestamp(),committed_count=staged where id=p_run_id;
  delete from public.nas_snapshot_stage where run_id=p_run_id;
  return staged::integer;
end;
$$;
revoke all on function public.nas_snapshot_begin(uuid,text) from public,anon,authenticated;
revoke all on function public.nas_snapshot_stage_batch(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.nas_snapshot_commit(uuid,integer) from public,anon,authenticated;
grant execute on function public.nas_snapshot_begin(uuid,text) to service_role;
grant execute on function public.nas_snapshot_stage_batch(uuid,jsonb) to service_role;
grant execute on function public.nas_snapshot_commit(uuid,integer) to service_role;
commit;
