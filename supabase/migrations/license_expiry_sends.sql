-- 라이선스 만료 알림 발송 이력
-- 같은 서비스·같은 시점(d30/d7/d0/overdue)·같은 채널·같은 수신자 중복 방지
-- 적용: Supabase SQL Editor (블루진)

create table if not exists public.license_expiry_sends (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  milestone text not null check (milestone in ('d30', 'd7', 'd0', 'overdue')),
  send_date date not null,
  channel text not null check (channel in ('email', 'in_app')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (service_id, milestone, send_date, channel, profile_id)
);

create index if not exists idx_license_expiry_sends_date
  on public.license_expiry_sends (send_date, channel);

comment on table public.license_expiry_sends is
  '라이선스 만료 알림 발송 이력. cron /api/cron/license-expiry 가 기록한다.';

alter table public.license_expiry_sends enable row level security;

grant all on public.license_expiry_sends to service_role;
