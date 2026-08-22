-- 실패 수집 — 원인 유형 컬럼 (선택)
-- 제시만. 실행은 블루진이 한다.
--
-- 앱은 조회 시 규칙으로 cause_type 을 계산한다 (재색인·백필 불필요).
-- 컬럼은 나중에 DB 필터·리포트용으로 쓸 때 채우면 된다.

begin;

alter table public.luna_failures
  add column if not exists cause_type text;

alter table public.luna_failures
  drop constraint if exists luna_failures_cause_type_check;

alter table public.luna_failures
  add constraint luna_failures_cause_type_check
  check (
    cause_type is null
    or cause_type in (
      'search_miss',
      'wiki_gap',
      'clarify_mishandle',
      'shallow_answer',
      'slow_response',
      'human_correction',
      'low_understanding',
      'unclassified'
    )
  );

create index if not exists luna_failures_cause_type_idx
  on public.luna_failures (cause_type, created_at desc)
  where cause_type is not null;

comment on column public.luna_failures.cause_type is
  '실패 원인 유형. 앱은 조회 시 규칙으로 계산하며, 이 컬럼은 선택적 캐시.';

commit;
