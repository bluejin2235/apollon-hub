-- 트렌드 레이더: RSS 수집 제거, 사이트 URL 기반 웹검색 수집으로 전환

alter table public.trend_sources
  drop column if exists rss_url;

update public.trend_sources
set collect_methods = array_remove(collect_methods, 'rss')
where 'rss' = any(collect_methods);

notify pgrst, 'reload schema';
