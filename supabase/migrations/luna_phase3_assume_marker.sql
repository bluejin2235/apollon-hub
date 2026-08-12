-- LUNA Phase 3 — talk.assume 가정 마커 규칙 + (참고) 피드백은 metadata 재사용
-- 실행: 블루진. 에이전트는 실행하지 않음.
--
-- 👍👎 피드백은 기존 luna_messages.metadata.feedback ('good'|'bad') 를 재사용하므로
-- luna_message_feedback 테이블은 만들지 않음.

BEGIN;

-- talk.assume content 끝에 마커 출력 규칙 1줄 추가 (버전 기록)
UPDATE public.luna_prompts
SET
  content = content || E'\n가정 확인 문장은 [[가정: 문장]] 형식으로 출력',
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'talk.assume'
  AND content NOT LIKE '%[[가정:%';

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
  'Phase 3: 가정 확인 [[가정:]] 마커 규칙',
  NULL,
  false
FROM public.luna_prompts p
WHERE p.prompt_key = 'talk.assume'
  AND p.content LIKE '%[[가정:%'
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_prompt_versions v
    WHERE v.target_id = p.id AND v.version = p.version
  );

COMMIT;
