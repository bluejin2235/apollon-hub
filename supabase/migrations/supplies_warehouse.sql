-- 비품 관리(물품창고) v2 — supply_locations, supplies, supply_loans
-- 기존 supplies 관련 테이블이 있으면 제거 후 재생성 (데이터 초기화 주의)

drop table if exists public.supply_notifications cascade;
drop table if exists public.supply_items cascade;
drop table if exists public.supply_loans cascade;
drop table if exists public.supplies cascade;
drop table if exists public.supply_locations cascade;

drop function if exists public.supplies_set_code() cascade;
drop function if exists public.generate_supply_code() cascade;
drop function if exists public.generate_supply_code(uuid) cascade;
drop function if exists public.is_supply_manager() cascade;

-- ── 보관 구역 (존 A/B/C… + 슬롯 A01…) ─────────────────────────
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

-- ── 비품 ────────────────────────────────────────────────────
create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  location_id uuid references public.supply_locations (id) on delete set null,
  quantity integer not null default 1,
  manager_id uuid references public.profiles (id) on delete set null,
  description text,
  components text,
  image_paths text[] not null default '{}',
  status text not null default 'available'
    check (status in ('available', 'borrowed', 'unavailable')),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplies_location on public.supplies (location_id);
create index if not exists idx_supplies_status on public.supplies (status);
create index if not exists idx_supplies_manager on public.supplies (manager_id);

-- ── 대출 기록 ───────────────────────────────────────────────
create table public.supply_loans (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies (id) on delete cascade,
  borrower_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null,
  due_date date not null,
  status text not null default 'active'
    check (status in ('active', 'returned')),
  return_image_path text,
  return_note text,
  borrowed_at timestamptz not null default now(),
  returned_at timestamptz
);

create index if not exists idx_supply_loans_supply on public.supply_loans (supply_id);
create index if not exists idx_supply_loans_borrower on public.supply_loans (borrower_id);
create index if not exists idx_supply_loans_status on public.supply_loans (status);

-- ── 코드 자동생성 (A01_001) ───────────────────────────────────
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

drop trigger if exists supplies_before_insert_set_code on public.supplies;
create trigger supplies_before_insert_set_code
  before insert on public.supplies
  for each row
  execute function public.supplies_set_code();

-- ── 관리자 역할 헬퍼 ────────────────────────────────────────
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

-- ── 기본 슬롯 데이터 ──────────────────────────────────────────
insert into public.supply_locations (zone_code, zone_name, slot_code) values
  ('A', '906호 책장서랍', 'A01'), ('A', '906호 책장서랍', 'A02'), ('A', '906호 책장서랍', 'A03'),
  ('A', '906호 책장서랍', 'A04'), ('A', '906호 책장서랍', 'A05'), ('A', '906호 책장서랍', 'A06'),
  ('B', '창고앵글', 'B01'), ('B', '창고앵글', 'B02'), ('B', '창고앵글', 'B03'), ('B', '창고앵글', 'B04'),
  ('C', '창고캐비넷', 'C01'), ('C', '창고캐비넷', 'C02'), ('C', '창고캐비넷', 'C03'),
  ('C', '창고캐비넷', 'C04'), ('C', '창고캐비넷', 'C05');

-- ── RLS ─────────────────────────────────────────────────────
alter table public.supply_locations enable row level security;
alter table public.supplies enable row level security;
alter table public.supply_loans enable row level security;

-- supply_locations
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

-- supplies
drop policy if exists "supplies_select_auth" on public.supplies;
create policy "supplies_select_auth"
  on public.supplies for select to authenticated using (true);

drop policy if exists "supplies_insert_manager" on public.supplies;
create policy "supplies_insert_manager"
  on public.supplies for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role::text in ('슈퍼관리자', '중간관리자')
    )
  );

drop policy if exists "supplies_update_auth" on public.supplies;
create policy "supplies_update_auth"
  on public.supplies for update to authenticated
  using (true) with check (true);

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

-- supply_loans
drop policy if exists "supply_loans_select_auth" on public.supply_loans;
create policy "supply_loans_select_auth"
  on public.supply_loans for select to authenticated using (true);

drop policy if exists "supply_loans_insert_auth" on public.supply_loans;
create policy "supply_loans_insert_auth"
  on public.supply_loans for insert to authenticated with check (true);

drop policy if exists "supply_loans_update_auth" on public.supply_loans;
create policy "supply_loans_update_auth"
  on public.supply_loans for update to authenticated
  using (true) with check (true);

-- ── GRANT ───────────────────────────────────────────────────
grant select on public.supply_locations to authenticated;
grant insert, update, delete on public.supply_locations to authenticated;

grant select on public.supplies to authenticated;
grant insert, update, delete on public.supplies to authenticated;

grant select on public.supply_loans to authenticated;
grant insert, update on public.supply_loans to authenticated;

grant execute on function public.generate_supply_code(uuid) to authenticated;
grant execute on function public.is_supply_manager() to authenticated;

-- ── 허브 카드 (access_level: 전체 — 모든 로그인 멤버) ───────
insert into public.services (
  name, description, icon, url, status, access_level, order_index, is_hub_card,
  plan, category, cost_type, cost_monthly, license_count
)
select
  '비품 관리',
  '비품 등록, 대출, 반납을 관리합니다',
  '📦',
  '/supplies',
  '활성',
  '전체',
  coalesce((select max(order_index) + 1 from public.services where is_hub_card = true), 2),
  true,
  null, null, null, 0, 0
where not exists (
  select 1 from public.services s where s.url = '/supplies' and s.is_hub_card = true
);
