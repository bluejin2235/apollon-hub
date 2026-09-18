-- 문답 세션. /q · 「답하기 시작」. 중간에 나가도 이어서 한다.
begin;

create table if not exists public.luna_qa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.luna_conversations (id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  cursor int not null default 0,
  answers jsonb not null default '[]'::jsonb,
  pending jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);

create index if not exists luna_qa_sessions_user_open_idx
  on public.luna_qa_sessions (user_id, started_at desc)
  where finished_at is null;

alter table public.luna_qa_sessions enable row level security;

revoke all on public.luna_qa_sessions from anon, authenticated;
grant all on public.luna_qa_sessions to service_role;

drop policy if exists luna_qa_sessions_own on public.luna_qa_sessions;
create policy luna_qa_sessions_own
  on public.luna_qa_sessions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

commit;
