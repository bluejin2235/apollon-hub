-- 1차 색인 강제 갱신 대기열
-- last_edited_time 이 안 바뀌어도(권한·properties null) 러너가 다시 읽는다.

begin;

create table if not exists public.luna_index_queue (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('notion', 'nas', 'image')),
  target_id text not null,
  reason text not null default 'stale'
    check (reason in ('stale', 'properties_null', 'relation_changed')),
  priority integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  queued_by text not null default 'selfstudy'
    check (queued_by in ('selfstudy', 'manual', 'cron')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text
);

create index if not exists luna_index_queue_status_priority_idx
  on public.luna_index_queue (status, priority desc, created_at asc);

create index if not exists luna_index_queue_source_target_idx
  on public.luna_index_queue (source, target_id);

create unique index if not exists luna_index_queue_active_uniq
  on public.luna_index_queue (source, target_id)
  where status in ('pending', 'running');

alter table public.luna_index_queue enable row level security;

grant all on public.luna_index_queue to service_role;
grant select on public.luna_index_queue to authenticated;

drop policy if exists luna_index_queue_admin_select on public.luna_index_queue;
create policy luna_index_queue_admin_select
  on public.luna_index_queue
  for select
  to authenticated
  using (public.is_super_admin());

comment on table public.luna_index_queue is
  '1차 색인 강제 갱신 대기열. last_edited_time 이 안 바뀌어도 러너가 다시 읽는다.';

commit;
