-- 지식후보 중복 비교 — duplicate_of
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.

BEGIN;

-- 무엇과 겹치는지. merge_target 은 정리(consolidation) 초안용으로 유지하고
-- 화면·판정은 duplicate_of 를 본다.
ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS duplicate_of uuid NULL
  REFERENCES public.luna_learnings (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.luna_learnings.duplicate_of IS
  '이 후보가 겹친다고 본 기존 지식(luna_learnings.id). 여러 건이면 가장 유사한 1건.';

CREATE INDEX IF NOT EXISTS idx_luna_learnings_duplicate_of
  ON public.luna_learnings (duplicate_of)
  WHERE duplicate_of IS NOT NULL;

-- 트라이그램: 백필·이후 재판정용
CREATE EXTENSION IF NOT EXISTS pg_trgm;

COMMIT;

-- ── 백필 (위 ALTER 커밋 후 실행) ────────────────────────────────
-- 1) 정리 작업이 남긴 merge_target 을 그대로 옮긴다.
UPDATE public.luna_learnings
SET duplicate_of = merge_target
WHERE status = 'candidate'
  AND review_reason = 'duplicate'
  AND duplicate_of IS NULL
  AND merge_target IS NOT NULL
  AND merge_target <> id;

-- 2) merge_target 이 없는 중복 후보: 활성 지식 중 가장 유사한 1건.
--    (한국어는 트라이그램이 약하니, 앱 GET 시 재점수와 함께 채운다)
WITH cand AS (
  SELECT id, content
  FROM public.luna_learnings
  WHERE status = 'candidate'
    AND COALESCE(review_reason, '') = 'duplicate'
    AND duplicate_of IS NULL
    AND category IS DISTINCT FROM 'identity'
),
best AS (
  SELECT DISTINCT ON (c.id)
    c.id AS cand_id,
    a.id AS match_id
  FROM cand c
  JOIN public.luna_learnings a
    ON a.status = 'active'
   AND a.category IS DISTINCT FROM 'identity'
   AND a.id <> c.id
  WHERE similarity(
          regexp_replace(lower(c.content), '\s+', ' ', 'g'),
          regexp_replace(lower(a.content), '\s+', ' ', 'g')
        ) >= 0.12
  ORDER BY c.id,
           similarity(
             regexp_replace(lower(c.content), '\s+', ' ', 'g'),
             regexp_replace(lower(a.content), '\s+', ' ', 'g')
           ) DESC
)
UPDATE public.luna_learnings l
SET
  duplicate_of = best.match_id,
  merge_target = COALESCE(l.merge_target, best.match_id),
  review_reason = 'duplicate'
FROM best
WHERE l.id = best.cand_id;

-- 3) 완전히 같은 문장(공백·대소문자만 다름): 후보만 삭제. 기존 지식은 그대로.
DELETE FROM public.luna_learnings AS c
USING public.luna_learnings AS a
WHERE c.status = 'candidate'
  AND c.category IS DISTINCT FROM 'identity'
  AND a.status = 'active'
  AND a.id = COALESCE(c.duplicate_of, c.merge_target)
  AND regexp_replace(lower(trim(c.content)), '\s+', ' ', 'g')
    = regexp_replace(lower(trim(a.content)), '\s+', ' ', 'g');
