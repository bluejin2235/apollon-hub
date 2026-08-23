-- 알림 읽음 · 종류별 수신 설정
-- 제시만. 실행은 블루진이 한다.
--
-- hub_notification_reads 는 이미 존재하며 앱이 사용 중이다.
--   PK (notification_id, user_id) — upsert onConflict 와 동일.
--   요청 스펙의 (user_id, notification_id) 와 동등하므로 기존 PK 를 바꾸지 않는다.

begin;

create table if not exists public.hub_notification_reads (
  notification_id uuid not null references public.hub_notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (notification_id, user_id)
);

create index if not exists hub_notification_reads_user_id_idx
  on public.hub_notification_reads (user_id);

comment on table public.hub_notification_reads is
  '사용자별 알림 읽음. 행이 있으면 읽음, 없으면 안 읽음.';

create table if not exists public.hub_notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  enabled boolean not null default true,
  primary key (user_id, category)
);

create index if not exists hub_notification_prefs_user_id_idx
  on public.hub_notification_prefs (user_id);

comment on table public.hub_notification_prefs is
  '사용자별 알림 종류 수신. 행 없음(기본값)은 켜짐. 끈 종류는 종 뱃지·드롭다운에서만 숨기고 알림 페이지에는 남긴다.';

alter table public.hub_notification_prefs enable row level security;

drop policy if exists hub_notification_prefs_own on public.hub_notification_prefs;
create policy hub_notification_prefs_own
  on public.hub_notification_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;
