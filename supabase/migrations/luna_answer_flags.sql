-- 답 모순 판정 (지표끼리 어긋남) — 사람 점검 큐
begin;

create table if not exists public.luna_answer_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid,
  question text not null default '',
  flags jsonb not null default '[]'::jsonb,
  severity int not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'reviewed', 'ignored')),
  human_verdict text
    check (human_verdict is null or human_verdict in ('good', 'bad', 'unclear')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  source text not null default 'chat'
    check (source in ('chat', 'mode_a', 'backfill')),
  created_at timestamptz not null default now()
);

create unique index if not exists luna_answer_flags_message_uidx
  on public.luna_answer_flags (message_id)
  where message_id is not null;

create index if not exists luna_answer_flags_status_sev_idx
  on public.luna_answer_flags (status, severity desc, created_at desc);

create index if not exists luna_answer_flags_created_at_idx
  on public.luna_answer_flags (created_at desc);

alter table public.luna_answer_flags enable row level security;

revoke all on public.luna_answer_flags from anon, authenticated;
grant all on public.luna_answer_flags to service_role;

drop policy if exists luna_answer_flags_admin_all on public.luna_answer_flags;
create policy luna_answer_flags_admin_all
  on public.luna_answer_flags
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
