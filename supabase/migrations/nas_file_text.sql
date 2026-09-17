-- Work 파일 본문 색인 (추출 · 청크 · 임베딩 · 실행 기록)
-- 적용은 블루진. 이 파일만 제시하고 자동 실행하지 않는 것이 원칙이나,
-- 1,000건 확인이 필요하면 수동/MCP 로 적용한다.

begin;

create extension if not exists vector;

create table if not exists public.nas_file_text (
  path text primary key,
  drive text not null,
  ext text not null,
  size_bytes bigint,
  modified_at timestamptz,
  content_hash text,
  text_length integer not null default 0,
  chunk_count integer not null default 0,
  status text not null default 'ok'
    check (status in ('ok', 'empty', 'failed', 'skipped')),
  skip_reason text,
  error text,
  extracted_at timestamptz,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nas_file_text is
  'Work서버 문서 본문 추출 메타. path 는 nas_directory.path (상대경로).';
comment on column public.nas_file_text.content_hash is
  '본문 sha256. 같으면 청크·임베딩 재생성 안 함.';
comment on column public.nas_file_text.skip_reason is
  'hwp · encrypted · corrupt · too_large · drawing_pdf · truncated_200_chunks · legacy_unsupported 등';

create index if not exists nas_file_text_status_idx
  on public.nas_file_text (status);
create index if not exists nas_file_text_modified_at_idx
  on public.nas_file_text (modified_at desc nulls last);
create index if not exists nas_file_text_ext_idx
  on public.nas_file_text (ext);
create index if not exists nas_file_text_drive_path_idx
  on public.nas_file_text (drive, path);
create index if not exists nas_file_text_extracted_at_idx
  on public.nas_file_text (extracted_at desc nulls last);

create table if not exists public.nas_file_chunks (
  id uuid primary key default gen_random_uuid(),
  path text not null references public.nas_file_text (path) on delete cascade,
  seq integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (path, seq)
);

comment on table public.nas_file_chunks is
  'Work 본문 청크 (1,000자·200자 겹침, 파일당 최대 200).';

create index if not exists nas_file_chunks_path_idx
  on public.nas_file_chunks (path);

-- 키워드 검색 (임베딩 없이). concurrently 는 트랜잭션 밖에서 실행.
--   create extension if not exists pg_trgm;
--   create index concurrently if not exists nas_file_chunks_content_trgm
--     on public.nas_file_chunks using gin (content gin_trgm_ops);
-- 노션 text_trgm 13MB / 1.4만 청크 → Work 20만 청크 시 ~190MB 예상.

-- ivfflat/HNSW 는 임베딩을 켤 때만. 지금은 생성하지 않음.

create table if not exists public.nas_text_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full', 'incremental')),
  status text not null default 'running'
    check (status in ('running', 'done', 'failed', 'interrupted')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  target_count integer not null default 0,
  ok integer not null default 0,
  "empty" integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  chunks_created integer not null default 0,
  embeddings_created integer not null default 0,
  cost_usd real not null default 0,
  last_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nas_text_runs is
  'Work 본문 추출·임베딩 실행 기록. 아침 리포트·luna_checks 가 읽는다.';

create index if not exists nas_text_runs_started_idx
  on public.nas_text_runs (started_at desc);
create index if not exists nas_text_runs_status_idx
  on public.nas_text_runs (status, started_at desc);

alter table public.nas_file_text enable row level security;
alter table public.nas_file_chunks enable row level security;
alter table public.nas_text_runs enable row level security;

revoke all on public.nas_file_text from anon, authenticated;
revoke all on public.nas_file_chunks from anon, authenticated;
revoke all on public.nas_text_runs from anon, authenticated;

grant select on public.nas_file_text to authenticated;
grant select on public.nas_file_chunks to authenticated;
grant select on public.nas_text_runs to authenticated;

grant all on public.nas_file_text to service_role;
grant all on public.nas_file_chunks to service_role;
grant all on public.nas_text_runs to service_role;

drop policy if exists nas_file_text_authenticated_select on public.nas_file_text;
create policy nas_file_text_authenticated_select
  on public.nas_file_text for select to authenticated using (true);

drop policy if exists nas_file_chunks_authenticated_select on public.nas_file_chunks;
create policy nas_file_chunks_authenticated_select
  on public.nas_file_chunks for select to authenticated using (true);

drop policy if exists nas_text_runs_authenticated_select on public.nas_text_runs;
create policy nas_text_runs_authenticated_select
  on public.nas_text_runs for select to authenticated using (true);

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values (
  'work_text',
  'Work 본문 추출',
  '매일 03:10 약속',
  2,
  3,
  'Work 문서 본문이 오래됐습니다. 파일 안 글자 검색이 낡은 색인을 봅니다.',
  '/settings?menu=knowledge&sub=primary',
  '지식 →',
  25
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
