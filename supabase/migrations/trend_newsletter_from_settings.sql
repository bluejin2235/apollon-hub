-- 트렌드 뉴스레터 발신 이메일 설정

insert into public.trend_settings (key, value)
values
  ('newsletter_from_email', 'trend@apollonworks.com'),
  ('newsletter_from_name', '아폴론 트렌드 레이더')
on conflict (key) do nothing;
