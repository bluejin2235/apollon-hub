-- LUNA 교정(teach): conflict_group / resolved_* 컬럼
-- status 는 기존 CHECK(candidate|active|conflict|archived) 값을 그대로 사용

alter table public.luna_learnings
  add column if not exists conflict_group uuid null;

alter table public.luna_learnings
  add column if not exists resolved_by uuid null references public.profiles (id) on delete set null;

alter table public.luna_learnings
  add column if not exists resolved_at timestamptz null;

create index if not exists idx_luna_learnings_conflict_group
  on public.luna_learnings (conflict_group)
  where conflict_group is not null;

create index if not exists idx_luna_learnings_origin_status
  on public.luna_learnings (origin, status);
