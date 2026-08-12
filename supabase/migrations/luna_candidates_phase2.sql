-- LUNA Phase 2 — 지식 후보함 (luna_learnings 확장)
-- 실행: 블루진. 에이전트는 실행하지 않음.

BEGIN;

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS source text;

UPDATE public.luna_learnings
SET source = CASE
  WHEN origin = 'direct' THEN 'direct'
  ELSE 'chat'
END
WHERE source IS NULL;

ALTER TABLE public.luna_learnings
  ALTER COLUMN source SET DEFAULT 'chat';

ALTER TABLE public.luna_learnings
  ALTER COLUMN source SET NOT NULL;

ALTER TABLE public.luna_learnings
  DROP CONSTRAINT IF EXISTS luna_learnings_source_check;

ALTER TABLE public.luna_learnings
  ADD CONSTRAINT luna_learnings_source_check
  CHECK (source = ANY (ARRAY['chat'::text, 'selfstudy'::text, 'question'::text, 'direct'::text]));

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS scope_suggestion text NULL;

ALTER TABLE public.luna_learnings
  DROP CONSTRAINT IF EXISTS luna_learnings_scope_suggestion_check;

ALTER TABLE public.luna_learnings
  ADD CONSTRAINT luna_learnings_scope_suggestion_check
  CHECK (
    scope_suggestion IS NULL
    OR scope_suggestion = ANY (ARRAY['org'::text, 'personal'::text])
  );

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS evidence text NULL;

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS thread jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS assigned_to uuid NULL
    REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_luna_learnings_status_source
  ON public.luna_learnings (status, source);

CREATE INDEX IF NOT EXISTS idx_luna_learnings_assigned_to
  ON public.luna_learnings (assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMIT;
