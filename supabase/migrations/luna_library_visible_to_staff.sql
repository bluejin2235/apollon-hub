-- 문서별 직원 공개 여부 (기본: 공개)
ALTER TABLE public.luna_library
  ADD COLUMN IF NOT EXISTS visible_to_staff boolean NOT NULL DEFAULT true;