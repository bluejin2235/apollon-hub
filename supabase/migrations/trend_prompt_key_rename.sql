-- 프롬프트 trend_settings 키 P1~P4 명칭으로 이전 (기존 행 유지·복사)

insert into public.trend_settings (key, value, updated_at)
select 'p1_luna_prompt', value, updated_at
from public.trend_settings where key = 'luna_system_prompt'
on conflict (key) do nothing;

insert into public.trend_settings (key, value, updated_at)
select 'p2_trend_prompt', value, updated_at
from public.trend_settings where key = 'chat_selection_prompt'
on conflict (key) do nothing;

insert into public.trend_settings (key, value, updated_at)
select 'p3_collect_prompt', value, updated_at
from public.trend_settings
where key in ('common_gpt_prompt', 'gpt_curator_prompt')
order by case key when 'common_gpt_prompt' then 0 else 1 end
limit 1
on conflict (key) do nothing;

insert into public.trend_settings (key, value, updated_at)
select 'p4_editor_prompt', value, updated_at
from public.trend_settings where key = 'editor_prompt'
on conflict (key) do nothing;
