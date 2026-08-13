-- LUNA 알림 정비: hub_notifications.link + notify_events.morning
-- (원격에 link 가 이미 있어도 안전 — IF NOT EXISTS)

alter table public.hub_notifications
  add column if not exists link text null;

comment on column public.hub_notifications.link is
  '알림 클릭 시 이동할 Hub 경로 (예: /settings?tab=luna&...)';

-- notify_events.morning 기본 true (없으면 추가)
update public.luna_settings
set
  value = coalesce(value, '{}'::jsonb) || '{"morning": true}'::jsonb,
  updated_at = now()
where key = 'notify_events'
  and (value->>'morning') is null;

insert into public.luna_settings (key, value, updated_at)
values (
  'notify_events',
  '{"consolidation":true,"study":true,"reflect":true,"conflict":true,"prompt_change":true,"exam":true,"morning":true}'::jsonb,
  now()
)
on conflict (key) do nothing;
