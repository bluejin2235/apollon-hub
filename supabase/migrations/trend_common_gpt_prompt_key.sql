-- common_gpt_prompt 키로 통일 (기존 gpt_curator_prompt 행은 유지·복사)

insert into public.trend_settings (key, value, updated_at)
select
  'common_gpt_prompt',
  value,
  updated_at
from public.trend_settings
where key = 'gpt_curator_prompt'
on conflict (key) do nothing;
