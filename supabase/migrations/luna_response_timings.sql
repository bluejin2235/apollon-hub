-- 루나 답변 단계별 응답 시간
begin;

create table if not exists public.luna_response_timings (
  id uuid primary key default gen_random_uuid(),
  message_id uuid,
  conversation_id uuid,
  user_id uuid,
  embed_ms integer not null default 0,
  search_ms integer not null default 0,
  link_ms integer not null default 0,
  rerank_ms integer,
  llm_ms integer not null default 0,
  total_ms integer not null default 0,
  candidates_found integer not null default 0,
  candidates_added integer not null default 0,
  candidates_used integer not null default 0,
  prompt_tokens integer,
  completion_tokens integer,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists luna_response_timings_created_at_idx
  on public.luna_response_timings (created_at desc);

create index if not exists luna_response_timings_message_id_idx
  on public.luna_response_timings (message_id)
  where message_id is not null;

alter table public.luna_response_timings enable row level security;

revoke all on public.luna_response_timings from anon, authenticated;
grant all on public.luna_response_timings to service_role;

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values (
  'response_time',
  '응답 시간',
  '매일',
  0,
  0,
  '7일 평균이 25초를 넘으면 검색·연결·LLM 중 어디가 느린지 대시보드에서 확인하세요.',
  '/settings?menu=dashboard',
  '대시보드 →',
  125
)
on conflict (id) do update set
  label = excluded.label,
  promise_label = excluded.promise_label,
  yellow_days = excluded.yellow_days,
  red_days = excluded.red_days,
  meaning_when_stale = excluded.meaning_when_stale,
  href = excluded.href,
  btn_label = excluded.btn_label,
  sort_order = excluded.sort_order,
  updated_at = now();

commit;
