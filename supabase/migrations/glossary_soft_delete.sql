-- 용어사전 소프트 삭제 (deleted_at)
-- 실행은 운영자가 직접 적용. 에이전트는 이 파일을 실행하지 않음.

alter table public.glossary_terms
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users (id);

comment on column public.glossary_terms.deleted_at is
  '소프트 삭제 시각. null 이면 활성 용어. 이력(glossary_versions)은 유지.';

-- 활성 용어만 term_ko 유니크 (삭제된 이름은 재등록 가능)
drop index if exists public.glossary_terms_term_ko_key;
create unique index if not exists glossary_terms_term_ko_active_key
  on public.glossary_terms (term_ko)
  where deleted_at is null;

create index if not exists idx_glossary_terms_deleted_at
  on public.glossary_terms (deleted_at)
  where deleted_at is null;
