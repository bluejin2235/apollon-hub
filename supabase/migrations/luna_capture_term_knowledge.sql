-- 지식후보 — 정의와 판단 갈라내기
-- 실행: 블루진. 에이전트는 실행하지 않음.
-- learn.capture 에 판정 기준을 붙인다. 코드에 키워드를 박지 않는다.

BEGIN;

UPDATE public.luna_prompts
SET
  content = content || E'\n\n## 정의와 판단\n용어사전이 우선이고, 아폴론 지식은 그 위에 쌓인다.\n각 후보는 capture_kind 로 나눈다.\n- term: "X는 무엇인가" — 뜻, 구성, 범위. 용어사전 후보.\n- knowledge: "우리는 어떻게 하는가" — 기준, 방식, 사례. 지식 후보.\n- both: 한 문장에 정의와 판단이 섞이면 갈라서 양쪽에 넣는다.\n  예: "마스터플랜은 컨셉 확정 후 단계이며, 우리는 이때 HW 설계를 먼저 잡는다"\n  → definition: 마스터플랜은 컨셉 확정 후 단계\n  → knowledge: 마스터플랜에서 HW 설계를 먼저 잡는다\n키워드 목록으로 판정하지 말 것. 문장이 뜻인지 우리 방식인지로 판정한다.\nJSON 후보마다 capture_kind, term/both이면 term_ko·definition, both이면 knowledge(판단 문장)를 채운다.',
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'learn.capture'
  AND content NOT LIKE '%capture_kind%';

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
  '지식후보 — 정의(term)와 판단(knowledge) 갈라내기',
  NULL,
  false
FROM public.luna_prompts p
WHERE p.prompt_key = 'learn.capture'
  AND p.content LIKE '%capture_kind%'
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_prompt_versions v
    WHERE v.target_id = p.id AND v.version = p.version
  );

COMMIT;
