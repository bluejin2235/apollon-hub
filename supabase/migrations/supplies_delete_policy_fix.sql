-- 비품 삭제 RLS: 슈퍼/중간관리자 + 해당 비품 manager_id 담당자
-- Supabase SQL Editor에서 실행

drop policy if exists "supplies_delete_manager" on public.supplies;
drop policy if exists "supplies_delete_allowed" on public.supplies;

create policy "supplies_delete_allowed"
  on public.supplies for delete to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role::text in ('슈퍼관리자', '중간관리자')
    )
    or manager_id = (select auth.uid())
  );
