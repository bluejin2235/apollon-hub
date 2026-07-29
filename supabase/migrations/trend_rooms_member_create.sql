-- 채팅방 생성: 로그인(authenticated) 멤버 전체 허용

drop policy if exists "trend_rooms_insert_research_manager" on public.trend_rooms;
drop policy if exists "trend_rooms_insert_super_admin" on public.trend_rooms;

drop policy if exists "trend_rooms_insert_auth" on public.trend_rooms;
create policy "trend_rooms_insert_auth"
  on public.trend_rooms for insert to authenticated
  with check (true);

grant insert on public.trend_rooms to authenticated;

notify pgrst, 'reload schema';
