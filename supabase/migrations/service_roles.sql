-- service_user_roles: 서비스별 권한(중간관리자) 관리
-- 적용: Supabase SQL Editor 또는 migration 파이프라인
--
-- 주의: profiles.role 은 member_role enum('슈퍼관리자','중간관리자','멤버') 이므로
--       "super_admin" 판정은 '슈퍼관리자'::member_role 로 비교해야 한다.
--       (이 테이블의 자체 role 컬럼은 서비스 단위 역할이라 '중간관리자' 텍스트를 사용)

-- ── 0) 슈퍼관리자 판정 헬퍼 (RLS 재귀 방지용 security definer) ──
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = '슈퍼관리자'::member_role
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- ── 1) 테이블 ────────────────────────────────────────────────
create table if not exists public.service_user_roles (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('중간관리자')),
  created_at timestamptz not null default now(),
  unique (service_id, profile_id)
);

create index if not exists idx_service_user_roles_service on public.service_user_roles (service_id);
create index if not exists idx_service_user_roles_profile on public.service_user_roles (profile_id);

-- ── 2) RLS ───────────────────────────────────────────────────
alter table public.service_user_roles enable row level security;

drop policy if exists "service_user_roles_select_auth" on public.service_user_roles;
drop policy if exists "service_user_roles_insert_super_admin" on public.service_user_roles;
drop policy if exists "service_user_roles_update_super_admin" on public.service_user_roles;
drop policy if exists "service_user_roles_delete_super_admin" on public.service_user_roles;

-- SELECT: 인증된 사용자 전체
create policy "service_user_roles_select_auth"
  on public.service_user_roles
  for select
  to authenticated
  using (true);

-- INSERT: 슈퍼관리자만
create policy "service_user_roles_insert_super_admin"
  on public.service_user_roles
  for insert
  to authenticated
  with check (public.is_super_admin());

-- UPDATE: 슈퍼관리자만
create policy "service_user_roles_update_super_admin"
  on public.service_user_roles
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- DELETE: 슈퍼관리자만
create policy "service_user_roles_delete_super_admin"
  on public.service_user_roles
  for delete
  to authenticated
  using (public.is_super_admin());

-- ── 3) GRANT (Supabase 2026.10 정책 대비: 명시적 grant) ───────
-- RLS 가 실제 접근을 제한하므로, 테이블 권한은 authenticated 에 명시적으로 부여.
grant select on public.service_user_roles to authenticated;
grant insert, update, delete on public.service_user_roles to authenticated;
-- service_role 은 RLS bypass 지만 일관성을 위해 함께 부여
grant select, insert, update, delete on public.service_user_roles to service_role;
