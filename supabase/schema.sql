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

-- 아슐랭 상세: 한 줄 소개, 메뉴판 이미지 경로
alter table public.restaurants
  add column if not exists tagline text;

alter table public.restaurants
  add column if not exists menu_image_paths text[] not null default '{}';

-- 매장 갤러리 (Storage 경로만 저장)
create table if not exists public.restaurant_images (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  storage_path text not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_restaurant_images_restaurant on public.restaurant_images (restaurant_id);

-- 리뷰: 0.5점 단위(2~10), 키워드, 사진, 재방문 의향
alter table public.reviews
  add column if not exists star_rating smallint;

alter table public.reviews
  add column if not exists keyword_tags text[] not null default '{}';

alter table public.reviews
  add column if not exists image_paths text[] not null default '{}';

alter table public.reviews
  add column if not exists revisit_intent text;

-- 기존 데이터 보정 (star_rating 없으면 정수 별점×2)
update public.reviews
set star_rating = rating * 2
where star_rating is null and rating is not null;

update public.reviews
set revisit_intent = case when revisit then 'again' else 'meh' end
where revisit_intent is null;

alter table public.reviews
  drop constraint if exists reviews_star_rating_check;

alter table public.reviews
  add constraint reviews_star_rating_check check (star_rating is null or (star_rating >= 2 and star_rating <= 10));

alter table public.reviews
  drop constraint if exists reviews_revisit_intent_check;

alter table public.reviews
  add constraint reviews_revisit_intent_check check (revisit_intent is null or revisit_intent in ('again', 'meh', 'never'));

-- Storage 버킷 (공개 읽기 — URL로 이미지 표시)
insert into storage.buckets (id, name, public)
values ('restaurant-images', 'restaurant-images', true),
       ('menu-images', 'menu-images', true),
       ('review-images', 'review-images', true)
on conflict (id) do update set public = excluded.public;

-- Storage RLS (storage 스키마)
drop policy if exists "restaurant_images_select" on storage.objects;
create policy "restaurant_images_select" on storage.objects for select using (bucket_id = 'restaurant-images');

drop policy if exists "restaurant_images_insert_authenticated" on storage.objects;
create policy "restaurant_images_insert_authenticated"
  on storage.objects for insert to authenticated with check (bucket_id = 'restaurant-images');

drop policy if exists "menu_images_select" on storage.objects;
create policy "menu_images_select" on storage.objects for select using (bucket_id = 'menu-images');

drop policy if exists "menu_images_insert_authenticated" on storage.objects;
create policy "menu_images_insert_authenticated"
  on storage.objects for insert to authenticated with check (bucket_id = 'menu-images');

drop policy if exists "menu_images_update_authenticated" on storage.objects;
create policy "menu_images_update_authenticated"
  on storage.objects for update to authenticated
  using (bucket_id = 'menu-images')
  with check (bucket_id = 'menu-images');

drop policy if exists "menu_images_delete_authenticated" on storage.objects;
create policy "menu_images_delete_authenticated"
  on storage.objects for delete to authenticated using (bucket_id = 'menu-images');

drop policy if exists "review_images_select" on storage.objects;
create policy "review_images_select" on storage.objects for select using (bucket_id = 'review-images');

drop policy if exists "review_images_insert_authenticated" on storage.objects;
create policy "review_images_insert_authenticated"
  on storage.objects for insert to authenticated with check (bucket_id = 'review-images');

drop policy if exists "review_images_update_authenticated" on storage.objects;
create policy "review_images_update_authenticated"
  on storage.objects for update to authenticated
  using (bucket_id = 'review-images')
  with check (bucket_id = 'review-images');

drop policy if exists "review_images_delete_authenticated" on storage.objects;
create policy "review_images_delete_authenticated"
  on storage.objects for delete to authenticated using (bucket_id = 'review-images');

-- restaurant_images 행 RLS
alter table public.restaurant_images enable row level security;

drop policy if exists "restaurant_images_select_all" on public.restaurant_images;
create policy "restaurant_images_select_all" on public.restaurant_images for select using (true);

drop policy if exists "restaurant_images_insert_auth" on public.restaurant_images;
create policy "restaurant_images_insert_auth" on public.restaurant_images for insert to authenticated with check (true);

drop policy if exists "restaurant_images_delete_auth" on public.restaurant_images;
create policy "restaurant_images_delete_auth" on public.restaurant_images for delete to authenticated using (true);
