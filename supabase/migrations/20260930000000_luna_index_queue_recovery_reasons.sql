-- Match the application's documented recovery reasons without changing data,
-- queue status rules, privileges, or row-level security.
begin;
alter table public.luna_index_queue
  drop constraint if exists luna_index_queue_reason_check;
alter table public.luna_index_queue
  add constraint luna_index_queue_reason_check
  check (reason in ('stale', 'properties_null', 'relation_changed',
                    'schema_changed', 'index_failed', 'manual'));
commit;
