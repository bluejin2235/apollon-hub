-- 비품 수정: 텍스트 필드 + 위치 변경 시 code 재발급 (단일 security definer RPC)
-- 적용: Supabase SQL Editor (검토 후 실행)

create or replace function public.update_supply_details(
  p_supply_id uuid,
  p_name text,
  p_location_id uuid,
  p_quantity integer,
  p_manager_id uuid,
  p_description text,
  p_components text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_location_id uuid;
  v_manager_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception '권한이 없습니다.';
  end if;

  select location_id, manager_id, code
    into v_old_location_id, v_manager_id, v_code
  from public.supplies
  where id = p_supply_id;

  if not found then
    raise exception 'Supply not found: %', p_supply_id;
  end if;

  if not (
    public.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = '중간관리자'::member_role
    )
    or v_manager_id = auth.uid()
    or exists (
      select 1
      from public.service_user_roles sur
      join public.services s on s.id = sur.service_id
      where sur.profile_id = auth.uid()
        and sur.role = '중간관리자'
        and s.url = '/supplies'
        and s.is_hub_card = true
    )
  ) then
    raise exception '권한이 없습니다.';
  end if;

  if p_location_id is distinct from v_old_location_id then
    if p_location_id is null then
      raise exception 'location_id is required';
    end if;
    v_code := public.generate_supply_code(p_location_id);
  end if;

  update public.supplies
  set
    name = p_name,
    location_id = p_location_id,
    quantity = p_quantity,
    manager_id = p_manager_id,
    description = p_description,
    components = p_components,
    code = v_code
  where id = p_supply_id;

  return v_code;
end;
$$;

revoke all on function public.update_supply_details(uuid, text, uuid, integer, uuid, text, text) from public;
grant execute on function public.update_supply_details(uuid, text, uuid, integer, uuid, text, text) to authenticated;
