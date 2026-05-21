-- 보관 구역 체계 v2 (A/B/C 존 + 슬롯) · 비품 코드 {slot_code}_{seq}
-- 기존 테스트 데이터 초기화. Supabase SQL Editor에서 실행.

-- ── 데이터 초기화 ───────────────────────────────────────────
truncate table public.supply_loans;
truncate table public.supplies;

-- ── supply_locations 스키마 개편 ────────────────────────────
alter table if exists public.supplies drop constraint if exists supplies_location_id_fkey;
drop table if exists public.supply_locations;

create table public.supply_locations (
  id uuid primary key default gen_random_uuid(),
  zone_code text not null,
  zone_name text not null,
  slot_code text not null,
  slot_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint supply_locations_slot_code_unique unique (slot_code),
  constraint supply_locations_zone_slot_unique unique (zone_code, slot_code)
);

create index if not exists idx_supply_locations_zone on public.supply_locations (zone_code);
create index if not exists idx_supply_locations_slot on public.supply_locations (slot_code);
create index if not exists idx_supply_locations_active on public.supply_locations (is_active) where is_active = true;

-- supplies.location_id FK 재연결
alter table public.supplies
  add constraint supplies_location_id_fkey
  foreign key (location_id) references public.supply_locations (id) on delete set null;

-- ── 기본 슬롯 데이터 ──────────────────────────────────────────
insert into public.supply_locations (zone_code, zone_name, slot_code, slot_label) values
  ('A', '906호 책장서랍', 'A01', null),
  ('A', '906호 책장서랍', 'A02', null),
  ('A', '906호 책장서랍', 'A03', null),
  ('A', '906호 책장서랍', 'A04', null),
  ('A', '906호 책장서랍', 'A05', null),
  ('A', '906호 책장서랍', 'A06', null),
  ('B', '창고앵글', 'B01', null),
  ('B', '창고앵글', 'B02', null),
  ('B', '창고앵글', 'B03', null),
  ('B', '창고앵글', 'B04', null),
  ('C', '창고캐비넷', 'C01', null),
  ('C', '창고캐비넷', 'C02', null),
  ('C', '창고캐비넷', 'C03', null),
  ('C', '창고캐비넷', 'C04', null),
  ('C', '창고캐비넷', 'C05', null);

-- ── 코드 자동생성: A01_001 형식 ───────────────────────────────
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
  select l.slot_code
    into v_slot_code
  from public.supply_locations l
  where l.id = p_location_id
    and l.is_active = true;

  if v_slot_code is null then
    raise exception 'Invalid or inactive location_id: %', p_location_id;
  end if;

  select coalesce(
    max((substring(s.code from length(v_slot_code) + 2))::integer),
    0
  ) + 1
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

drop trigger if exists supplies_before_insert_set_code on public.supplies;
create trigger supplies_before_insert_set_code
  before insert on public.supplies
  for each row
  execute function public.supplies_set_code();

grant execute on function public.generate_supply_code(uuid) to authenticated;

-- ── RLS (supply_locations 재생성 후) ─────────────────────────
alter table public.supply_locations enable row level security;

drop policy if exists "supply_locations_select_auth" on public.supply_locations;
create policy "supply_locations_select_auth"
  on public.supply_locations for select to authenticated using (true);

drop policy if exists "supply_locations_insert_manager" on public.supply_locations;
create policy "supply_locations_insert_manager"
  on public.supply_locations for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
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

grant select on public.supply_locations to authenticated;
grant insert, update, delete on public.supply_locations to authenticated;
