-- Claude 메모리 방식 — 사람당 한 줄. memo 한 덩어리 글.
begin;

create table if not exists public.luna_user_memories (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  memo text not null default '',
  answer_length text not null default 'normal'
    check (answer_length in ('short', 'normal', 'detailed')),
  source_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists luna_user_memories_updated_at_idx
  on public.luna_user_memories (updated_at desc);

alter table public.luna_user_memories enable row level security;

revoke all on public.luna_user_memories from anon, authenticated;
grant select, update, delete on public.luna_user_memories to authenticated;
grant all on public.luna_user_memories to service_role;

drop policy if exists luna_user_memories_select_own on public.luna_user_memories;
create policy luna_user_memories_select_own
  on public.luna_user_memories
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists luna_user_memories_update_own on public.luna_user_memories;
create policy luna_user_memories_update_own
  on public.luna_user_memories
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists luna_user_memories_delete_own on public.luna_user_memories;
create policy luna_user_memories_delete_own
  on public.luna_user_memories
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- insert 는 service_role (비동기 갱신) 전용. 인증 사용자는 upsert 불가.

commit;
