-- reflect 멱등성: 워터마크 + 단기 락
-- 실행: 블루진 / MCP apply_migration

begin;

alter table public.luna_conversations
  add column if not exists last_reflected_at timestamptz null;

alter table public.luna_conversations
  add column if not exists last_reflected_message_count integer not null default 0;

alter table public.luna_conversations
  add column if not exists reflect_lock_until timestamptz null;

comment on column public.luna_conversations.last_reflected_at is
  '마지막 성공 reflect 시점. 이후 메시지만 재분석.';
comment on column public.luna_conversations.last_reflected_message_count is
  '마지막 reflect 당시 luna_messages 건수. 이하면 skip.';
comment on column public.luna_conversations.reflect_lock_until is
  'reflect 실행 중 락. 만료 전 동시 실행 거부.';

commit;
