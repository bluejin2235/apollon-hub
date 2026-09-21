-- 이미지 색인: 시작할 때 규칙 버전을 남겨 아침 리포트가 옛 잡을 가린다.
begin;

alter table public.luna_media_index_runs
  add column if not exists rules_version text;

comment on column public.luna_media_index_runs.rules_version is
  '시작 시점 media-index-rules 지문. 아침 리포트가 현재 코드와 비교한다.';

commit;
