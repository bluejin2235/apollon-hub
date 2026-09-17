-- 대시보드 저장 공간: RPC · 스냅샷 · 예상 · luna_checks

begin;

create or replace function public.luna_storage_usage()
returns table (grp text, bytes bigint)
language sql
security definer
set search_path = public
as $$
  select case
    when c.relname like 'luna_notion%' then '노션'
    when c.relname like 'luna_media%' then '이미지'
    when c.relname like 'nas_%' then 'Work서버'
    when c.relname in ('luna_links', 'luna_perspectives') then '2차 데이터'
    when c.relname like 'luna_wiki%' or c.relname = 'luna_library'
         or c.relname like 'glossary%' then '위키·용어'
    when c.relname like 'luna_%' then 'LUNA 기타'
    when c.relname like 'trend%' then '트렌드'
    else '그 밖'
  end,
  sum(pg_total_relation_size(c.oid))::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  group by 1;
$$;

revoke all on function public.luna_storage_usage() from public;
revoke execute on function public.luna_storage_usage() from public, anon;
grant execute on function public.luna_storage_usage() to authenticated, service_role;

create or replace function public.luna_storage_top_tables(limit_n integer default 6)
returns table (table_name text, bytes bigint)
language sql
security definer
set search_path = public
as $$
  select c.relname::text, pg_total_relation_size(c.oid)::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc
  limit greatest(1, least(coalesce(limit_n, 6), 50));
$$;

revoke all on function public.luna_storage_top_tables(integer) from public;
revoke execute on function public.luna_storage_top_tables(integer) from public, anon;
grant execute on function public.luna_storage_top_tables(integer) to authenticated, service_role;

create table if not exists public.luna_storage_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_on date not null,
  grp text not null default '',
  table_name text not null default '',
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists luna_storage_snapshots_day_table_uniq
  on public.luna_storage_snapshots (taken_on, table_name)
  where table_name <> '';

create unique index if not exists luna_storage_snapshots_day_grp_uniq
  on public.luna_storage_snapshots (taken_on, grp)
  where table_name = '' and grp <> '';

create index if not exists luna_storage_snapshots_taken_on_idx
  on public.luna_storage_snapshots (taken_on desc);

alter table public.luna_storage_snapshots enable row level security;
revoke all on public.luna_storage_snapshots from anon, authenticated;
grant all on public.luna_storage_snapshots to service_role;
grant select on public.luna_storage_snapshots to authenticated;

drop policy if exists luna_storage_snapshots_admin_select on public.luna_storage_snapshots;
create policy luna_storage_snapshots_admin_select
  on public.luna_storage_snapshots
  for select
  to authenticated
  using (public.is_super_admin());

create table if not exists public.luna_storage_forecast (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  note text not null default '',
  estimated_bytes bigint not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.luna_storage_forecast enable row level security;
revoke all on public.luna_storage_forecast from anon, authenticated;
grant all on public.luna_storage_forecast to service_role;
grant select on public.luna_storage_forecast to authenticated;

drop policy if exists luna_storage_forecast_admin_select on public.luna_storage_forecast;
create policy luna_storage_forecast_admin_select
  on public.luna_storage_forecast
  for select
  to authenticated
  using (public.is_super_admin());

insert into public.luna_storage_forecast (label, note, estimated_bytes, status, sort_order)
select v.label, v.note, v.estimated_bytes, v.status, v.sort_order
from (values
  ('Work 본문', '19,515건', 1932735283::bigint, 'pending', 10),
  ('이미지 전체', '77,065장', 429496730::bigint, 'pending', 20),
  ('2차 데이터', '2024 이전', 214748365::bigint, 'running', 30),
  ('증분', '노션·Work', 52428800::bigint, 'running', 40)
) as v(label, note, estimated_bytes, status, sort_order)
where not exists (select 1 from public.luna_storage_forecast limit 1);

-- 기존 disk 행을 저장 공간 점검으로 교체
update public.luna_checks
set
  label = '저장 공간',
  promise_label = '디스크 70% 미만',
  yellow_days = 0,
  red_days = 0,
  meaning_when_stale = 'DB 디스크가 한도의 70%를 넘었습니다. Pro 한도(설정값)를 확인하고 옛 데이터를 정리하세요.',
  href = '/settings?menu=dashboard',
  btn_label = '대시보드 →',
  sort_order = 120,
  updated_at = now()
where id = 'disk';

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
)
select
  'disk',
  '저장 공간',
  '디스크 70% 미만',
  0,
  0,
  'DB 디스크가 한도의 70%를 넘었습니다. Pro 한도(설정값)를 확인하고 옛 데이터를 정리하세요.',
  '/settings?menu=dashboard',
  '대시보드 →',
  120
where not exists (select 1 from public.luna_checks where id = 'disk');

notify pgrst, 'reload schema';

commit;
