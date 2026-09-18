-- 기간별 쌓임 — 날짜로 묶어 한 번에 센다. 화면이 18만 행을 끌어오지 않게.

create or replace function public.luna_primary_trend_days(p_start timestamptz)
returns table(day date, work bigint, notion bigint, image bigint)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select d::date as day
    from generate_series(
      timezone('Asia/Seoul', p_start)::date,
      timezone('Asia/Seoul', now())::date,
      interval '1 day'
    ) as d
  ),
  w as (
    select timezone('Asia/Seoul', extracted_at)::date as day, count(*)::bigint as n
    from public.nas_file_text
    where extracted_at >= p_start and status = 'ok'
    group by 1
  ),
  n as (
    select timezone('Asia/Seoul', indexed_at)::date as day, count(*)::bigint as n
    from public.luna_notion_pages
    where indexed_at >= p_start
    group by 1
  ),
  i as (
    select timezone('Asia/Seoul', indexed_at)::date as day, count(*)::bigint as n
    from public.luna_media_index
    where indexed_at >= p_start
    group by 1
  )
  select
    days.day,
    coalesce(w.n, 0),
    coalesce(n.n, 0),
    coalesce(i.n, 0)
  from days
  left join w using (day)
  left join n using (day)
  left join i using (day)
  order by days.day;
$$;

revoke all on function public.luna_primary_trend_days(timestamptz) from public, anon;
grant execute on function public.luna_primary_trend_days(timestamptz) to service_role;
