-- profiles UPDATE RLS 보안 강화
-- 문제: profiles_update_auth (authenticated, true) →任意 멤버가 자신의 role을 슈퍼관리자로 변경 가능
-- 적용: Supabase SQL Editor 또는 migration 파이프라인

-- ── 1) 기존 UPDATE 정책 제거 ─────────────────────────────────
drop policy if exists "profiles_update_auth" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_admin_role" on public.profiles;

-- ── 2) 본인 프로필: name / department / email 만 (행 단위 RLS, role·status는 트리거로 차단) ──
create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── 3) 슈퍼관리자: 다른 사용자 프로필 수정 (팀 관리 role/status 변경 등) ──
create policy "profiles_update_admin_role"
  on public.profiles
  for update
  to authenticated
  using (
    id <> auth.uid()
    and exists (
      select 1
      from public.profiles admin
      where admin.id = auth.uid()
        and admin.role = '슈퍼관리자'::member_role
    )
  )
  with check (
    id <> auth.uid()
    and exists (
      select 1
      from public.profiles admin
      where admin.id = auth.uid()
        and admin.role = '슈퍼관리자'::member_role
    )
  );

-- ── 4) role 자가 변경 방지 트리거 ─────────────────────────────
-- 본인 행에서 role 변경 시: 슈퍼관리자만 허용 (그 외 raise)
create or replace function public.profiles_prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if old.id = auth.uid() then
      if not exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = '슈퍼관리자'::member_role
      ) then
        raise exception
          '본인의 권한(role)은 직접 변경할 수 없습니다. 관리자에게 문의하세요.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_self_change on public.profiles;

create trigger profiles_prevent_role_self_change
  before update on public.profiles
  for each row
  execute function public.profiles_prevent_role_self_change();
