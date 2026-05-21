-- 비품 supplies INSERT RLS 수정 (is_supply_manager / insert 정책)
-- Supabase SQL Editor에서 실행

create or replace function public.is_supply_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.role::text in ('슈퍼관리자', '중간관리자')
      from public.profiles p
      where p.id = (select auth.uid())
      limit 1
    ),
    false
  );
$$;

grant execute on function public.is_supply_manager() to authenticated;

drop policy if exists "supplies_insert_manager" on public.supplies;
create policy "supplies_insert_manager"
  on public.supplies for insert to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  );

drop policy if exists "supply_locations_insert_manager" on public.supply_locations;
create policy "supply_locations_insert_manager"
  on public.supply_locations for insert to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  );

drop policy if exists "supply_locations_update_manager" on public.supply_locations;
create policy "supply_locations_update_manager"
  on public.supply_locations for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  );

drop policy if exists "supply_locations_delete_manager" on public.supply_locations;
create policy "supply_locations_delete_manager"
  on public.supply_locations for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  );

drop policy if exists "supplies_delete_manager" on public.supplies;
drop policy if exists "supplies_delete_allowed" on public.supplies;
create policy "supplies_delete_allowed"
  on public.supplies for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
    )
    or manager_id = (select auth.uid())
  );

-- 코드 생성 (A01_001) — supply_locations_v2 미적용 DB용 보조
drop function if exists public.generate_supply_code();
drop function if exists public.generate_supply_code(uuid);

create or replace function public.generate_supply_code(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_code text;
  next_seq integer;
begin
  select l.slot_code into v_slot_code
  from public.supply_locations l
  where l.id = p_location_id and l.is_active = true;

  if v_slot_code is null then
    raise exception 'Invalid or inactive location_id: %', p_location_id;
  end if;

  select coalesce(max((substring(s.code from length(v_slot_code) + 2))::integer), 0) + 1
    into next_seq
  from public.supplies s
  where s.location_id = p_location_id
    and s.code ~ ('^' || v_slot_code || '_[0-9]{3}$');

  return v_slot_code || '_' || lpad(next_seq::text, 3, '0');
end;
$$;

create or replace function public.supplies_set_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or trim(new.code) = '' then
    if new.location_id is null then
      raise exception 'location_id is required to generate supply code';
    end if;
    new.code := public.generate_supply_code(new.location_id);
  end if;
  return new;
end;
$$;

grant execute on function public.generate_supply_code(uuid) to authenticated;
