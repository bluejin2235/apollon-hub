-- Luna: 대화 / 메시지 / 러닝 테이블
-- 적용: Supabase SQL Editor 또는 migration 파이프라인

-- ── 1) luna_conversations ────────────────────────────────────
create table if not exists public.luna_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '새 대화',
  engine text not null default 'auto',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_luna_conversations_user
  on public.luna_conversations (user_id);

alter table public.luna_conversations enable row level security;

drop policy if exists "luna_conversations_own" on public.luna_conversations;
create policy "luna_conversations_own"
  on public.luna_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.luna_conversations to authenticated;

-- ── 2) luna_messages ─────────────────────────────────────────
create table if not exists public.luna_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.luna_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  engine text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_luna_messages_conversation
  on public.luna_messages (conversation_id, created_at);

alter table public.luna_messages enable row level security;

drop policy if exists "luna_messages_own" on public.luna_messages;
create policy "luna_messages_own"
  on public.luna_messages for all
  using (
    exists (
      select 1
      from public.luna_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.luna_conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.luna_messages to authenticated;

-- ── 3) luna_learnings ────────────────────────────────────────
create table if not exists public.luna_learnings (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  content text not null,
  source_conversation_id uuid references public.luna_conversations (id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_luna_learnings_category
  on public.luna_learnings (category);

alter table public.luna_learnings enable row level security;

drop policy if exists "luna_learnings_read" on public.luna_learnings;
create policy "luna_learnings_read"
  on public.luna_learnings for select
  using (auth.role() = 'authenticated');

drop policy if exists "luna_learnings_admin" on public.luna_learnings;
create policy "luna_learnings_admin"
  on public.luna_learnings for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select on public.luna_learnings to authenticated;
grant insert, update, delete on public.luna_learnings to authenticated;
