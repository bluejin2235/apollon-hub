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

-- atmosphere_tags: 허용 값은 앱 `lib/restaurants/types.ts`의 ATMOSPHERE_TAG_OPTIONS와 동기화 (컬럼은 text[] 제약 없음)
alter table public.restaurants
  add column if not exists atmosphere_tags text[] not null default '{}';

-- 아슐랭: 카테고리 다중 선택 (`category`는 첫 태그와 동기화)
alter table public.restaurants
  add column if not exists categories text[] not null default '{}';

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

-- 아슐랭 게시판 (의견·아이디어 등, 댓글 테이블은 추후 확장)
create table if not exists public.ashuleng_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  author_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_ashuleng_posts_created on public.ashuleng_posts (created_at desc);
create index if not exists idx_ashuleng_posts_author on public.ashuleng_posts (author_id);

alter table public.ashuleng_posts enable row level security;

drop policy if exists "ashuleng_posts_select_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_select_auth"
  on public.ashuleng_posts for select to authenticated using (true);

drop policy if exists "ashuleng_posts_insert_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_insert_auth"
  on public.ashuleng_posts for insert to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  );

drop policy if exists "ashuleng_posts_update_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_update_auth"
  on public.ashuleng_posts for update to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  );

drop policy if exists "ashuleng_posts_delete_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_delete_auth"
  on public.ashuleng_posts for delete to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  );

-- 아슐랭 댓글 (게시글 상세 모달)
create table if not exists public.ashuleng_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ashuleng_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ashuleng_comments_post on public.ashuleng_comments (post_id, created_at);
create index if not exists idx_ashuleng_comments_author on public.ashuleng_comments (author_id);

alter table public.ashuleng_comments enable row level security;

drop policy if exists "ashuleng_comments_select_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_select_auth"
  on public.ashuleng_comments for select to authenticated using (true);

drop policy if exists "ashuleng_comments_insert_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_insert_auth"
  on public.ashuleng_comments for insert to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  );

drop policy if exists "ashuleng_comments_delete_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_delete_auth"
  on public.ashuleng_comments for delete to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      inner join auth.users u on lower(u.email) = lower(p.email)
      where u.id = auth.uid() and p.id = author_id
    )
  );

-- ═════════════════════════════════════════════════════════════
-- RLS 정책 동기화 (Supabase 대시보드 현재 상태와 일치)
-- ─────────────────────────────────────────────────────────────
-- 모든 정책: authenticated 역할 / 조건 (true)
--   → 로그인된 모든 유저에게 전체 권한 허용. 권한 제어는 애플리케이션 레이어에서 수행.
-- 이전 ashuleng_posts/comments 의 email-join 정책은 auth.users.id === profiles.id 보장 이후 (true) 로 대체.
-- 참고: 본 섹션은 위에서 정의된 동일 이름 정책을 다시 drop+create 하여 최종 상태로 통일합니다.
-- 참고: lunch_votes 는 대시보드 RLS 정책 목록에 없어 본 동기화에서 제외 (필요 시 별도 요청).
-- ═════════════════════════════════════════════════════════════

-- ── profiles ────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_auth" on public.profiles;
create policy "profiles_update_auth"
  on public.profiles for update to authenticated
  using (true) with check (true);

-- ── restaurants ─────────────────────────────────────────────
alter table public.restaurants enable row level security;

drop policy if exists "restaurants_select_auth" on public.restaurants;
create policy "restaurants_select_auth"
  on public.restaurants for select to authenticated using (true);

drop policy if exists "restaurants_insert_auth" on public.restaurants;
create policy "restaurants_insert_auth"
  on public.restaurants for insert to authenticated with check (true);

drop policy if exists "restaurants_update_auth" on public.restaurants;
create policy "restaurants_update_auth"
  on public.restaurants for update to authenticated
  using (true) with check (true);

drop policy if exists "restaurants_delete_auth" on public.restaurants;
create policy "restaurants_delete_auth"
  on public.restaurants for delete to authenticated using (true);

-- ── reviews ─────────────────────────────────────────────────
alter table public.reviews enable row level security;

drop policy if exists "reviews_select_auth" on public.reviews;
create policy "reviews_select_auth"
  on public.reviews for select to authenticated using (true);

drop policy if exists "reviews_insert_auth" on public.reviews;
create policy "reviews_insert_auth"
  on public.reviews for insert to authenticated with check (true);

drop policy if exists "reviews_update_auth" on public.reviews;
create policy "reviews_update_auth"
  on public.reviews for update to authenticated
  using (true) with check (true);

drop policy if exists "reviews_delete_auth" on public.reviews;
create policy "reviews_delete_auth"
  on public.reviews for delete to authenticated using (true);

-- ── restaurant_images: select/insert/update/delete 4종 통일 ─
-- (위에서 정의된 select_all/insert_auth/delete_auth 를 새 select_auth + update_auth 로 일관화)
drop policy if exists "restaurant_images_select_all" on public.restaurant_images;

drop policy if exists "restaurant_images_select_auth" on public.restaurant_images;
create policy "restaurant_images_select_auth"
  on public.restaurant_images for select to authenticated using (true);

drop policy if exists "restaurant_images_insert_auth" on public.restaurant_images;
create policy "restaurant_images_insert_auth"
  on public.restaurant_images for insert to authenticated with check (true);

drop policy if exists "restaurant_images_update_auth" on public.restaurant_images;
create policy "restaurant_images_update_auth"
  on public.restaurant_images for update to authenticated
  using (true) with check (true);

drop policy if exists "restaurant_images_delete_auth" on public.restaurant_images;
create policy "restaurant_images_delete_auth"
  on public.restaurant_images for delete to authenticated using (true);

-- ── services ───────────────────────────────────────────────
alter table public.services enable row level security;

drop policy if exists "services_select_auth" on public.services;
create policy "services_select_auth"
  on public.services for select to authenticated using (true);

drop policy if exists "services_insert_auth" on public.services;
create policy "services_insert_auth"
  on public.services for insert to authenticated with check (true);

drop policy if exists "services_update_auth" on public.services;
create policy "services_update_auth"
  on public.services for update to authenticated
  using (true) with check (true);

drop policy if exists "services_delete_auth" on public.services;
create policy "services_delete_auth"
  on public.services for delete to authenticated using (true);

-- ── ashuleng_posts: 위 email-join 정책을 (true) 로 교체 ─────
drop policy if exists "ashuleng_posts_select_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_select_auth"
  on public.ashuleng_posts for select to authenticated using (true);

drop policy if exists "ashuleng_posts_insert_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_insert_auth"
  on public.ashuleng_posts for insert to authenticated with check (true);

drop policy if exists "ashuleng_posts_update_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_update_auth"
  on public.ashuleng_posts for update to authenticated
  using (true) with check (true);

drop policy if exists "ashuleng_posts_delete_auth" on public.ashuleng_posts;
create policy "ashuleng_posts_delete_auth"
  on public.ashuleng_posts for delete to authenticated using (true);

-- ── ashuleng_comments: select / insert / delete (update 정책 없음) ──
drop policy if exists "ashuleng_comments_select_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_select_auth"
  on public.ashuleng_comments for select to authenticated using (true);

drop policy if exists "ashuleng_comments_insert_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_insert_auth"
  on public.ashuleng_comments for insert to authenticated with check (true);

drop policy if exists "ashuleng_comments_delete_auth" on public.ashuleng_comments;
create policy "ashuleng_comments_delete_auth"
  on public.ashuleng_comments for delete to authenticated using (true);

-- ── licenses 4종 ───────────────────────────────────────────
-- 주의: licenses / license_users / license_managers / license_credentials 테이블은
--      현재 schema.sql 에 `create table` 정의가 없습니다.
--      Supabase 대시보드에서 별도로 생성된 상태이며, 본 섹션은 그 위 RLS 정책만 동기화합니다.
--      테이블 정의 동기화는 별도 작업으로 진행 권장.

alter table public.licenses enable row level security;

drop policy if exists "licenses_select_auth" on public.licenses;
create policy "licenses_select_auth"
  on public.licenses for select to authenticated using (true);

drop policy if exists "licenses_insert_auth" on public.licenses;
create policy "licenses_insert_auth"
  on public.licenses for insert to authenticated with check (true);

drop policy if exists "licenses_update_auth" on public.licenses;
create policy "licenses_update_auth"
  on public.licenses for update to authenticated
  using (true) with check (true);

drop policy if exists "licenses_delete_auth" on public.licenses;
create policy "licenses_delete_auth"
  on public.licenses for delete to authenticated using (true);

alter table public.license_users enable row level security;

drop policy if exists "license_users_select_auth" on public.license_users;
create policy "license_users_select_auth"
  on public.license_users for select to authenticated using (true);

drop policy if exists "license_users_insert_auth" on public.license_users;
create policy "license_users_insert_auth"
  on public.license_users for insert to authenticated with check (true);

drop policy if exists "license_users_update_auth" on public.license_users;
create policy "license_users_update_auth"
  on public.license_users for update to authenticated
  using (true) with check (true);

drop policy if exists "license_users_delete_auth" on public.license_users;
create policy "license_users_delete_auth"
  on public.license_users for delete to authenticated using (true);

alter table public.license_managers enable row level security;

drop policy if exists "license_managers_select_auth" on public.license_managers;
create policy "license_managers_select_auth"
  on public.license_managers for select to authenticated using (true);

drop policy if exists "license_managers_insert_auth" on public.license_managers;
create policy "license_managers_insert_auth"
  on public.license_managers for insert to authenticated with check (true);

drop policy if exists "license_managers_update_auth" on public.license_managers;
create policy "license_managers_update_auth"
  on public.license_managers for update to authenticated
  using (true) with check (true);

drop policy if exists "license_managers_delete_auth" on public.license_managers;
create policy "license_managers_delete_auth"
  on public.license_managers for delete to authenticated using (true);

alter table public.license_credentials enable row level security;

drop policy if exists "license_credentials_select_auth" on public.license_credentials;
create policy "license_credentials_select_auth"
  on public.license_credentials for select to authenticated using (true);

drop policy if exists "license_credentials_insert_auth" on public.license_credentials;
create policy "license_credentials_insert_auth"
  on public.license_credentials for insert to authenticated with check (true);

drop policy if exists "license_credentials_update_auth" on public.license_credentials;
create policy "license_credentials_update_auth"
  on public.license_credentials for update to authenticated
  using (true) with check (true);

drop policy if exists "license_credentials_delete_auth" on public.license_credentials;
create policy "license_credentials_delete_auth"
  on public.license_credentials for delete to authenticated using (true);

-- ═════════════════════════════════════════════════════════════
-- GRANT (PostgREST 노출 역할: authenticated, service_role)
-- ─────────────────────────────────────────────────────────────
-- 기본 권한 부여. RLS 가 켜진 테이블은 정책 통과 시에만 실제 접근 가능.
-- service_role 은 일반적으로 RLS 를 bypass 하지만 grant 는 명시적으로 추가.
-- ═════════════════════════════════════════════════════════════

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════
-- Hub 서비스 카드 관리 (services 테이블 확장)
-- ─────────────────────────────────────────────────────────────
-- 기존 services 테이블은 라이선스 관리(/licenses)의 read 측에서 사용 중.
-- 같은 테이블에 hub 카드 행도 보관하기 위해 디스크리미네이터 `is_hub_card` 를 추가.
--   - 라이선스 행: is_hub_card = false (기본값), 모든 라이선스 컬럼 사용
--   - 허브 카드 행: is_hub_card = true, plan/category/cost_type 등 라이선스 컬럼은 null
-- ═════════════════════════════════════════════════════════════

-- 허브 카드용 컬럼 추가
alter table public.services add column if not exists description text;
alter table public.services add column if not exists icon text;
alter table public.services add column if not exists url text;
alter table public.services add column if not exists access_level text not null default '전체';
alter table public.services add column if not exists order_index integer not null default 0;
alter table public.services add column if not exists is_hub_card boolean not null default false;

-- access_level 값 제약
alter table public.services drop constraint if exists services_access_level_check;
alter table public.services
  add constraint services_access_level_check
  check (access_level in ('전체', '슈퍼관리자', '중간관리자'));

-- 라이선스 컬럼들은 허브 카드 행에서는 의미 없으므로 nullable 화
alter table public.services alter column plan drop not null;
alter table public.services alter column category drop not null;
alter table public.services alter column cost_type drop not null;

-- 라이선스 카드 UI 의 통화/계약 표현용 컬럼.
--   - cost: 원본 통화 기준 입력 금액 (cost_monthly 는 호환을 위해 동일 값 유지)
--   - currency: 'KRW' | 'USD' | 'EUR' (기본 'KRW')
--   - contract_type: '월 구독' | '년 구독' | '영구 라이선스' (cost_type 보다 세부)
--   - next_payment_date: 다음 결제일 (월/년 구독에서만 사용, 영구 라이선스는 null)
alter table public.services add column if not exists cost numeric(12, 2);
alter table public.services add column if not exists currency text default 'KRW';
alter table public.services add column if not exists contract_type text;
alter table public.services add column if not exists next_payment_date date;
-- 반복 결제일 (월/년 구독 전용)
--   - payment_day:   1~31 (월/년 구독 모두)
--   - payment_month: 1~12 (년 구독 전용)
-- next_payment_date 컬럼은 더 이상 사용하지 않고 위 두 컬럼으로부터 다음 결제일을 동적으로 계산.
alter table public.services add column if not exists payment_day integer;
alter table public.services add column if not exists payment_month integer;

-- 인덱스
create index if not exists idx_services_is_hub_card on public.services (is_hub_card);
create index if not exists idx_services_order_index on public.services (is_hub_card, order_index);

-- Seed: 라이선스매니저, 아슐랭 (멱등)
delete from public.services
  where is_hub_card = true
    and name in ('Apollon License Manager', '아슐랭');

insert into public.services (
  name, description, icon, url, status, access_level, order_index, is_hub_card,
  plan, category, cost_type, cost_monthly, license_count
) values
  ('Apollon License Manager',
   '라이선스 발급, 관리, 상태 조회를 위한 통합 관리 서비스',
   '🔑', '/licenses', '활성', '전체', 0, true,
   null, null, null, 0, 0),
  ('아슐랭',
   '아폴론 미식가들이 직접 뽑은 아슐랭 가이드',
   '🍱', '/restaurants', '활성', '전체', 1, true,
   null, null, null, 0, 0);
