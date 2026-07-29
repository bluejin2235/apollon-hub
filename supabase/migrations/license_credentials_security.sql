-- license_credentials RLS 보안 강화
-- 문제: authenticated (true) → 모든 로그인 사용자가 타 서비스 비밀번호 조회 가능
-- 적용: Supabase SQL Editor 또는 migration 파이프라인

-- 슈퍼관리자 또는 해당 서비스 담당자(license_managers.profile_id = auth.uid())
create or replace function public.can_manage_license_credentials(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = '슈퍼관리자'::member_role
  )
  or exists (
    select 1
    from public.license_managers lm
    where lm.service_id = p_service_id
      and lm.profile_id = auth.uid()
  );
$$;

revoke all on function public.can_manage_license_credentials(uuid) from public;
grant execute on function public.can_manage_license_credentials(uuid) to authenticated;

-- ── 기존 정책 제거 ───────────────────────────────────────────
drop policy if exists "license_credentials_select_auth" on public.license_credentials;
drop policy if exists "license_credentials_insert_auth" on public.license_credentials;
drop policy if exists "license_credentials_update_auth" on public.license_credentials;
drop policy if exists "license_credentials_delete_auth" on public.license_credentials;

drop policy if exists "license_credentials_select_manager_or_admin" on public.license_credentials;
drop policy if exists "license_credentials_insert_manager_or_admin" on public.license_credentials;
drop policy if exists "license_credentials_update_manager_or_admin" on public.license_credentials;
drop policy if exists "license_credentials_delete_manager_or_admin" on public.license_credentials;

-- ── SELECT: 슈퍼관리자 또는 해당 서비스 담당자만 ─────────────
create policy "license_credentials_select_manager_or_admin"
  on public.license_credentials
  for select
  to authenticated
  using (public.can_manage_license_credentials(service_id));

-- ── INSERT / UPDATE / DELETE: 동일 조건 ───────────────────────
create policy "license_credentials_insert_manager_or_admin"
  on public.license_credentials
  for insert
  to authenticated
  with check (public.can_manage_license_credentials(service_id));

create policy "license_credentials_update_manager_or_admin"
  on public.license_credentials
  for update
  to authenticated
  using (public.can_manage_license_credentials(service_id))
  with check (public.can_manage_license_credentials(service_id));

create policy "license_credentials_delete_manager_or_admin"
  on public.license_credentials
  for delete
  to authenticated
  using (public.can_manage_license_credentials(service_id));
