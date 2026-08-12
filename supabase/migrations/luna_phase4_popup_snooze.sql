-- LUNA Phase 4 — 루나 팝업 (능동 질문)
-- 실행: 블루진. 에이전트는 실행하지 않음.
-- source='question' 후보는 luna_learnings 재사용. assigned_to 는 Phase 2 컬럼.

BEGIN;

ALTER TABLE public.luna_learnings
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_luna_learnings_question_assigned
  ON public.luna_learnings (assigned_to, status, source)
  WHERE source = 'question' AND status = 'candidate';

-- learn.capture: 확인 질문(question) 조항 추가
UPDATE public.luna_prompts
SET
  content = content || $cap_q$

[확인이 필요한 질문]
대화에서 확정이 필요한 사실·선호·절차가 있으면, 지식 후보와 별도로
사람에게 물을 질문을 최대 1건 제안할 수 있다.
- 본인(대화 상대)만 답할 수 있는 내용만. 남의 일·추측 금지.
- 질문은 짧고 한 번에 하나만.
- 없으면 question 은 null.
$cap_q$,
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'learn.capture'
  AND is_active = true
  AND content NOT LIKE '%[확인이 필요한 질문]%';

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
    'sort_order', p.sort_order
  ),
  'Phase 4: 확인 질문(question) 조항',
  NULL,
  false
FROM public.luna_prompts p
WHERE p.prompt_key = 'learn.capture'
  AND p.is_active = true
  AND p.content LIKE '%[확인이 필요한 질문]%'
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_prompt_versions v
    WHERE v.target_id = p.id AND v.version = p.version
  );

COMMIT;
