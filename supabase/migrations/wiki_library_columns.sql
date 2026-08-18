-- Apollon Wikipedia — luna_library 확장 (1/4)
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.
-- 새 테이블 없음. glossary_terms 는 손대지 않음.

BEGIN;

ALTER TABLE public.luna_library
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'forms',
  ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS related jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_name text,
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.luna_library
  DROP CONSTRAINT IF EXISTS luna_library_category_check;
ALTER TABLE public.luna_library
  ADD CONSTRAINT luna_library_category_check
  CHECK (category IN ('forms', 'standards', 'rules'));

COMMENT ON COLUMN public.luna_library.category IS
  '위키 분류. forms=양식, standards=기준, rules=규정.';
COMMENT ON COLUMN public.luna_library.sections IS
  '[{id, title, body}] 절 단위 본문. content 는 MAKE 주입용 평문 캐시.';
COMMENT ON COLUMN public.luna_library.history IS
  '판 이력. 되돌리기도 새 판으로 쌓는다. 별도 테이블 없음.';
COMMENT ON COLUMN public.luna_library.use_count IS
  'MAKE 가 이 문서를 읽어 답한 횟수.';
COMMENT ON COLUMN public.luna_library.related IS
  '[{kind:doc|term, category?, slug?, title}] 관련 문서·용어.';

CREATE INDEX IF NOT EXISTS luna_library_category_idx
  ON public.luna_library (category, is_active, title);

COMMIT;
