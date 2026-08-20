-- 실패 수집 — 잘 안 된 순간을 모은다
-- 제시만. 실행은 블루진이 한다.

begin;

create table if not exists public.luna_failures (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.luna_messages(id) on delete set null,
  conversation_id uuid references public.luna_conversations(id) on delete set null,
  asked_by uuid references public.profiles(id) on delete set null,
  question text not null default '',
  answer_excerpt text not null default '',
  kind text not null check (kind in ('human', 'self', 'auto')),
  signal text not null check (
    signal in (
      'thumbs_down',
      'correction',
      'candidate_deleted',
      'low_intent',
      'low_confidence',
      'not_found',
      'unclassified',
      'zero_search',
      'eval_fail'
    )
  ),
  intent_score smallint check (intent_score is null or (intent_score >= 1 and intent_score <= 10)),
  confidence_score smallint check (confidence_score is null or (confidence_score >= 1 and confidence_score <= 10)),
  self_note text,
  types text[] not null default '{}',
  sources_used jsonb not null default '{}',
  duration_ms integer,
  cluster_key text,
  verdict text check (verdict is null or verdict in ('improve', 'skip')),
  improve_note text,
  improve_target text check (
    improve_target is null or improve_target in ('knowledge', 'dev_wiki', 'prompt')
  ),
  db_fixes jsonb not null default '[]'::jsonb,
  dev_prompt text,
  db_done_at timestamptz,
  dev_done_at timestamptz,
  dev_fixed_at timestamptz,
  source_ref jsonb not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.luna_failures add column if not exists db_fixes jsonb not null default '[]'::jsonb;
alter table public.luna_failures add column if not exists dev_prompt text;
alter table public.luna_failures add column if not exists db_done_at timestamptz;
alter table public.luna_failures add column if not exists dev_done_at timestamptz;
alter table public.luna_failures add column if not exists dev_fixed_at timestamptz;

create index if not exists luna_failures_verdict_created_idx
  on public.luna_failures (verdict, created_at desc);

create index if not exists luna_failures_signal_created_idx
  on public.luna_failures (signal, created_at desc);

create index if not exists luna_failures_cluster_key_idx
  on public.luna_failures (cluster_key, created_at desc)
  where cluster_key is not null;

create unique index if not exists luna_failures_message_signal_uidx
  on public.luna_failures (message_id, signal)
  where message_id is not null;

alter table public.luna_failures enable row level security;

grant all on public.luna_failures to service_role;

-- 베타: 답변 하단 자체 점수 표시 (나중에 false 로 끌 수 있음)
insert into public.luna_settings (key, value, updated_at)
values (
  'answer_scores_visible',
  '{"visible": true}'::jsonb,
  now()
)
on conflict (key) do nothing;

commit;
