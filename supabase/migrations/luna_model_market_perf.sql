-- luna_model_market: 속도·지연·추론 여부 (자동 교체 A/B 판정용)
-- 실행은 블루진이 한다. 에이전트는 적용하지 않음.

alter table public.luna_model_market
  add column if not exists median_output_tokens_per_second numeric,
  add column if not exists median_time_to_first_token_seconds numeric,
  add column if not exists is_reasoning boolean;

comment on column public.luna_model_market.median_output_tokens_per_second is
  'Artificial Analysis performance.median_output_tokens_per_second';
comment on column public.luna_model_market.median_time_to_first_token_seconds is
  'Artificial Analysis performance.median_time_to_first_token_seconds (TTFT)';
comment on column public.luna_model_market.is_reasoning is
  '추론(thinking) 모델 여부. A/B 등급 후보에서 제외';
