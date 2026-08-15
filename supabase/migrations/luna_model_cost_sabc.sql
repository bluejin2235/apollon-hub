-- LUNA model·cost: S/A/B/C tiers, usage feature, market cache, change log
-- 실행은 블루진이 한다. 에이전트는 적용하지 않음.

-- 1) luna_engine_tiers: S 추가 + check 재정의
alter table public.luna_engine_tiers drop constraint if exists luna_engine_tiers_tier_check;
alter table public.luna_engine_tiers
  add constraint luna_engine_tiers_tier_check
  check (tier = any (array['S'::text, 'A'::text, 'B'::text, 'C'::text]));

insert into public.luna_engine_tiers
  (tier, provider, model_id, model_label, use_caching, use_batch, note)
values
  ('S', 'anthropic', 'claude-opus-4-6', 'Claude Opus 4.6', false, false, '자기개선 — 실수하면 안 됨'),
  ('A', 'anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6', true, false, '사람이 읽는 결과물'),
  ('B', 'anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', false, false, '기계가 쓰는 실시간 판정'),
  ('C', 'anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', false, true, '배치 · 사람 검토를 거침')
on conflict (tier) do update set
  provider = excluded.provider,
  model_id = excluded.model_id,
  model_label = excluded.model_label,
  use_caching = excluded.use_caching,
  use_batch = excluded.use_batch,
  note = excluded.note,
  updated_at = now();

-- 2) luna_usage_daily.feature
alter table public.luna_usage_daily
  add column if not exists feature text;

-- 기존 unique(date, tier, model_id) 가 있다면 feature 포함으로 재정의
-- (프로젝트마다 제약명이 다를 수 있어 이름 확인 후 조정)
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.luna_usage_daily'::regclass
    and contype = 'u'
  limit 1;
  if cname is not null then
    execute format('alter table public.luna_usage_daily drop constraint %I', cname);
  end if;
end $$;

create unique index if not exists luna_usage_daily_date_tier_model_feature_uidx
  on public.luna_usage_daily (date, tier, model_id, coalesce(feature, ''));

-- luna_bump_usage RPC 가 있으면 feature 인자 추가 버전으로 교체 (기존 시그니처와 병행 가능하면 overload)
create or replace function public.luna_bump_usage(
  p_date date,
  p_tier text,
  p_model_id text,
  p_in int,
  p_out int,
  p_cw int,
  p_cr int,
  p_feature text default null
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.luna_usage_daily as u
    (date, tier, model_id, feature, calls, input_tokens, output_tokens,
     cache_write_tokens, cache_read_tokens)
  values
    (p_date, p_tier, p_model_id, p_feature, 1, coalesce(p_in,0), coalesce(p_out,0),
     coalesce(p_cw,0), coalesce(p_cr,0))
  on conflict (date, tier, model_id, coalesce(feature, ''))
  do update set
    calls = u.calls + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens;
exception when others then
  -- unique 인덱스가 아직 없으면 date+tier+model 로 fallback upsert
  insert into public.luna_usage_daily as u
    (date, tier, model_id, feature, calls, input_tokens, output_tokens,
     cache_write_tokens, cache_read_tokens)
  values
    (p_date, p_tier, p_model_id, p_feature, 1, coalesce(p_in,0), coalesce(p_out,0),
     coalesce(p_cw,0), coalesce(p_cr,0));
end;
$$;

-- 3) Artificial Analysis 시장 캐시
create table if not exists public.luna_model_market (
  id bigserial primary key,
  model_slug text not null,
  creator text,
  provider text,
  intelligence_index numeric,
  multilingual_index numeric,
  agentic_index numeric,
  price_input numeric,
  price_output numeric,
  price_blended numeric,
  price_cache_read numeric,
  fetched_at timestamptz not null default now()
);

create index if not exists luna_model_market_fetched_idx
  on public.luna_model_market (fetched_at desc);

create index if not exists luna_model_market_slug_fetched_idx
  on public.luna_model_market (model_slug, fetched_at desc);

-- 4) 모델 교체 이력
create table if not exists public.luna_model_changes (
  id uuid primary key default gen_random_uuid(),
  tier text not null,
  from_provider text,
  from_model_id text,
  from_model_label text,
  to_provider text not null,
  to_model_id text not null,
  to_model_label text not null,
  reason text,
  savings_krw_month numeric,
  exam_result text, -- keep | up | down | revert | pending
  exam_note text,
  reverted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists luna_model_changes_created_idx
  on public.luna_model_changes (created_at desc);

-- 5) 모델·비용 설정 키 기본값 (luna_settings)
insert into public.luna_settings (key, value, updated_at)
values (
  'model_cost_settings',
  jsonb_build_object(
    'auto_swap', true,
    'revert_on_drop', true,
    'protect_s', true,
    'last_inspect_at', null,
    'next_inspect_at', null
  ),
  now()
)
on conflict (key) do nothing;
