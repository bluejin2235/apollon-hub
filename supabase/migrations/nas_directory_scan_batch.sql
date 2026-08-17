-- nas_directory 스캔 세대(scan_batch).
-- 실행: 블루진 (Supabase SQL Editor). 에이전트가 실행하지 않는다.
-- 적용 뒤에만 새 스캐너(삽입→검증→이전 삭제)를 돌린다.

alter table public.nas_directory
  add column if not exists scan_batch timestamptz;

update public.nas_directory
set scan_batch = now()
where scan_batch is null;

alter table public.nas_directory
  alter column scan_batch set default now();

alter table public.nas_directory
  alter column scan_batch set not null;

-- 세대가 겹치는 동안 같은 drive+path 가 두 줄일 수 있다.
alter table public.nas_directory
  drop constraint if exists nas_directory_drive_path_key;

create unique index if not exists nas_directory_drive_path_batch_key
  on public.nas_directory (drive, path, scan_batch);

create index if not exists nas_directory_drive_batch_idx
  on public.nas_directory (drive, scan_batch);
