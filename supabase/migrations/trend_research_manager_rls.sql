-- 트렌드 레이더: 중간관리자(/research) 관리 권한 확장

create or replace function public.is_research_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.service_user_roles sur
      join public.services s on s.id = sur.service_id
      where sur.profile_id = (select auth.uid())
        and sur.role = '중간관리자'
        and s.url = '/research'
        and s.is_hub_card = true
    );
$$;

revoke all on function public.is_research_manager() from public;
grant execute on function public.is_research_manager() to authenticated;

-- trend_settings: 슈퍼관리자 + 트렌드 레이더 중간관리자
drop policy if exists "trend_settings_insert_super_admin" on public.trend_settings;
drop policy if exists "trend_settings_update_super_admin" on public.trend_settings;
drop policy if exists "trend_settings_delete_super_admin" on public.trend_settings;

create policy "trend_settings_insert_research_manager"
  on public.trend_settings for insert to authenticated
  with check (public.is_research_manager());

create policy "trend_settings_update_research_manager"
  on public.trend_settings for update to authenticated
  using (public.is_research_manager())
  with check (public.is_research_manager());

create policy "trend_settings_delete_research_manager"
  on public.trend_settings for delete to authenticated
  using (public.is_research_manager());

-- trend_rooms: 관리자만 삭제
drop policy if exists "trend_rooms_delete_research_manager" on public.trend_rooms;
create policy "trend_rooms_delete_research_manager"
  on public.trend_rooms for delete to authenticated
  using (public.is_research_manager());

-- trend_messages: 관리자는 모든 메시지, 일반 사용자는 본인 메시지 삭제
drop policy if exists "trend_messages_delete_allowed" on public.trend_messages;
create policy "trend_messages_delete_allowed"
  on public.trend_messages for delete to authenticated
  using (
    public.is_research_manager()
    or profile_id = (select auth.uid())
  );

grant delete on public.trend_rooms to authenticated;
grant delete on public.trend_messages to authenticated;

notify pgrst, 'reload schema';
