-- Luna: 스킬 + 스킬 개선 제안

create table if not exists public.luna_skills (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  prompt text not null,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_luna_skills_active
  on public.luna_skills (is_active);

alter table public.luna_skills enable row level security;

drop policy if exists "luna_skills_select_auth" on public.luna_skills;
create policy "luna_skills_select_auth"
  on public.luna_skills for select
  using (auth.role() = 'authenticated');

drop policy if exists "luna_skills_admin" on public.luna_skills;
create policy "luna_skills_admin"
  on public.luna_skills for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select on public.luna_skills to authenticated;
grant insert, update, delete on public.luna_skills to authenticated;

create table if not exists public.luna_skill_proposals (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.luna_skills (id) on delete cascade,
  proposed_prompt text not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

create index if not exists idx_luna_skill_proposals_status
  on public.luna_skill_proposals (status);

alter table public.luna_skill_proposals enable row level security;

drop policy if exists "luna_skill_proposals_admin" on public.luna_skill_proposals;
create policy "luna_skill_proposals_admin"
  on public.luna_skill_proposals for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select, insert, update, delete on public.luna_skill_proposals to authenticated;
