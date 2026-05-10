-- Apollon OS initial schema
-- Run in Supabase SQL Editor.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type member_role as enum ('슈퍼관리자', '중간관리자', '멤버');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type member_status as enum ('근무', '휴직', '퇴사');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_cost_type') then
    create type service_cost_type as enum ('월간', '연간', '영구');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  department text not null,
  role member_role not null default '멤버',
  status member_status not null default '근무',
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null,
  category text not null,
  status text not null,
  cost_monthly numeric(12, 2) not null default 0,
  cost_type service_cost_type not null,
  license_count integer not null default 0 check (license_count >= 0),
  next_renewal date,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  address text not null,
  lat double precision,
  lng double precision,
  menu text,
  price_range text,
  description text,
  is_entertainment boolean not null default false,
  registered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  visit_date date,
  revisit boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_status on public.profiles (status);
create index if not exists idx_services_assignee_id on public.services (assignee_id);
create index if not exists idx_restaurants_registered_by on public.restaurants (registered_by);
create index if not exists idx_reviews_restaurant_id on public.reviews (restaurant_id);
create index if not exists idx_reviews_reviewer_id on public.reviews (reviewer_id);

-- 아슐랭: 음식 종류·분위기 태그 (다중 선택 저장)
alter table public.restaurants
  add column if not exists food_type text[] not null default '{}';

alter table public.restaurants
  add column if not exists atmosphere_tags text[] not null default '{}';

-- 이번 주 점심 투표 (주 시작일=월요일 기준, 멤버당 1표)
create table if not exists public.lunch_votes (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (week_start, voter_id)
);

create index if not exists idx_lunch_votes_week on public.lunch_votes (week_start);
create index if not exists idx_lunch_votes_restaurant on public.lunch_votes (restaurant_id);
