-- 1차 원천 집계 — 매일 03:30 에 한 번 계산, 화면은 이 표를 읽기만 한다.

create table if not exists public.luna_source_stats (
  day date not null,
  source text not null
    check (source in ('work', 'notion', 'wiki', 'glossary')),
  total bigint not null default 0,
  by_kind jsonb not null default '{}'::jsonb,
  delta jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (day, source)
);

alter table public.luna_source_stats enable row level security;
revoke all on public.luna_source_stats from anon, authenticated;
grant all on public.luna_source_stats to service_role;
grant select on public.luna_source_stats to authenticated;

create index if not exists luna_media_index_indexed_at_idx
  on public.luna_media_index (indexed_at desc);
create index if not exists luna_notion_pages_indexed_at_desc_idx
  on public.luna_notion_pages (indexed_at desc);
create index if not exists nas_directory_drive_type_idx
  on public.nas_directory (drive, type);
-- nas_file_text (extracted_at) 는 이미 있음.
