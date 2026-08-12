-- LUNA Phase 5 — learn.selfstudy 활성화
-- 실행: 블루진. 에이전트는 실행하지 않음.

BEGIN;

UPDATE public.luna_prompts
SET
  is_active = true,
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'learn.selfstudy'
  AND is_active = false;

INSERT INTO public.luna_prompt_versions (
  target_type, target_id, version, content, change_summary, changed_by, changed_by_luna
)
SELECT
  'prompt',
  p.id,
  p.version,
  jsonb_build_object(
    'title', p.title,
    'description', p.description,
    'purpose', p.purpose,
    'content', p.content,
    'owner_id', p.owner_id,
    'sort_order', p.sort_order,
    'is_active', p.is_active
  ),
  'Phase 5: learn.selfstudy 활성화',
  NULL,
  false
FROM public.luna_prompts p
WHERE p.prompt_key = 'learn.selfstudy'
  AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_prompt_versions v
    WHERE v.target_id = p.id AND v.version = p.version
  );

COMMIT;
