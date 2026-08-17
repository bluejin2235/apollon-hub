-- KNOW 웹 보강. 행이 없어도 코드는 enabled=true 로 기본한다.
-- 실행: 블루진 (Supabase SQL Editor). 이 파일은 제시용이며 에이전트가 실행하지 않는다.

insert into public.luna_settings (key, value, updated_at)
values ('web_augment', '{"enabled": true}'::jsonb, now())
on conflict (key) do nothing;
