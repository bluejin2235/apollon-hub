-- KNOW가 위키 절을 먼저 읽도록 type.know 프롬프트 보강
-- 실행: 블루진. 에이전트는 실행하지 않음.

BEGIN;

UPDATE public.luna_prompts
SET
  content = content || E'\n\n## 위키 절 우선\n- 위키 문서의 절이 주어지면 그것을 우선한다. 문서는 사람이 직접 쓴 것이다.\n- 위키에 답이 있으면 아폴론 지식보다 그것을 먼저 쓴다.\n- 절에는 조건과 예외가 함께 있으므로 조건을 빼고 답하지 않는다.\n- 위키 내용을 쓰면 어느 문서의 어느 절인지 밝힌다.',
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'type.know'
  AND content NOT LIKE '%## 위키 절 우선%';

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
  'KNOW가 위키 절을 우선 읽도록 보강',
  NULL,
  false
FROM public.luna_prompts p
WHERE p.prompt_key = 'type.know'
  AND p.content LIKE '%## 위키 절 우선%'
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_prompt_versions v
    WHERE v.target_id = p.id AND v.version = p.version
  );

COMMIT;
