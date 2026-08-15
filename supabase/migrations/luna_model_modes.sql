-- luna_model_modes: 가격/가성비/성능 모드 이력
-- 실행은 블루진이 한다. 에이전트는 적용하지 않음.

create table if not exists public.luna_model_modes (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode = any (array['cheap'::text, 'balanced'::text, 'performance'::text])),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  est_monthly_krw numeric,
  exam_score text,
  thumbs_up integer not null default 0,
  thumbs_down integer not null default 0
);

create index if not exists luna_model_modes_started_idx
  on public.luna_model_modes (started_at desc);

create index if not exists luna_model_modes_open_idx
  on public.luna_model_modes (started_at desc)
  where ended_at is null;

-- 설정 기본 mode = balanced (기존 행이 있으면 mode 키만 보강)
update public.luna_settings
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('mode', 'balanced'),
    updated_at = now()
where key = 'model_cost_settings'
  and (value->>'mode') is null;
