-- 노션 색인 실행 이력 + 예약/제외 설정 (luna_settings)
-- 적용은 수동. 이 파일만 제시하고 자동 실행하지 않음.

create table if not exists public.luna_notion_index_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('full', 'incremental')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_total integer not null default 0,
  pages_processed integer not null default 0,
  pages_skipped integer not null default 0,
  blocks integer not null default 0,
  embeddings_added integer not null default 0,
  duration_ms integer,
  status text not null check (status in ('running', 'success', 'failed')),
  error_message text,
  triggered_by text not null check (triggered_by in ('cron', 'manual')),
  triggered_by_user uuid,
  abort_requested boolean not null default false,
  checkpoint jsonb not null default '{}'::jsonb
);

create index if not exists luna_notion_index_runs_started_at_idx
  on public.luna_notion_index_runs (started_at desc);

create index if not exists luna_notion_index_runs_status_idx
  on public.luna_notion_index_runs (status);

comment on table public.luna_notion_index_runs is
  '노션 색인 실행 이력. checkpoint 로 청크 재개.';

-- 기본 예약·제외 (없을 때만)
insert into public.luna_settings (key, value, updated_at)
values (
  'notion_index_schedule',
  '{"full":{"enabled":true,"time":"03:20"},"incremental":{"enabled":true,"time":"13:30"}}'::jsonb,
  now()
)
on conflict (key) do nothing;

insert into public.luna_settings (key, value, updated_at)
values (
  'notion_index_exclude',
  '{"min_block_length":15,"exclude_paths":[]}'::jsonb,
  now()
)
on conflict (key) do nothing;
