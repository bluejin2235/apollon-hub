-- 「찾았어요」 사람 피드백 — hit@ 보다 앞서는 지표
begin;

create table if not exists public.luna_answer_found (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.luna_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  found boolean not null,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists luna_answer_found_message_user_uidx
  on public.luna_answer_found (message_id, user_id);

create index if not exists luna_answer_found_created_at_idx
  on public.luna_answer_found (created_at desc);

create index if not exists luna_answer_found_found_idx
  on public.luna_answer_found (found, created_at desc);

alter table public.luna_answer_found enable row level security;

revoke all on public.luna_answer_found from anon, authenticated;
grant all on public.luna_answer_found to service_role;

drop policy if exists luna_answer_found_admin_all on public.luna_answer_found;
create policy luna_answer_found_admin_all
  on public.luna_answer_found
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
