drop policy if exists "supplies_update_auth" on public.supplies;
drop policy if exists "supplies_update_allowed" on public.supplies;
drop policy if exists "supplies_delete_allowed" on public.supplies;

create policy "supplies_update_allowed"
  on public.supplies
  for update
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = '중간관리자'::member_role
    )
    or manager_id = auth.uid()
    or exists (
      select 1
      from public.service_user_roles sur
      join public.services s on s.id = sur.service_id
      where sur.profile_id = auth.uid()
        and sur.role = '중간관리자'
        and s.url = '/supplies'
        and s.is_hub_card = true
    )
  )
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = '중간관리자'::member_role
    )
    or manager_id = auth.uid()
    or exists (
      select 1
      from public.service_user_roles sur
      join public.services s on s.id = sur.service_id
      where sur.profile_id = auth.uid()
        and sur.role = '중간관리자'
        and s.url = '/supplies'
        and s.is_hub_card = true
    )
  );

create policy "supplies_delete_allowed"
  on public.supplies
  for delete
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = '중간관리자'::member_role
    )
    or manager_id = auth.uid()
    or exists (
      select 1
      from public.service_user_roles sur
      join public.services s on s.id = sur.service_id
      where sur.profile_id = auth.uid()
        and sur.role = '중간관리자'
        and s.url = '/supplies'
        and s.is_hub_card = true
    )
  );
