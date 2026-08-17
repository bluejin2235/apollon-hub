-- 두뇌 > 프롬프트 — 생각의 순서 (stage / 번호 / title)
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.
-- 본문(content) 변경 금지. prompt_key 변경 금지. 행 삭제 금지.

BEGIN;

ALTER TABLE public.luna_prompts
  ADD COLUMN IF NOT EXISTS stage integer,
  ADD COLUMN IF NOT EXISTS stage_order integer,
  ADD COLUMN IF NOT EXISTS parent_key text;

COMMENT ON COLUMN public.luna_prompts.stage IS
  '생각의 순서 1~7. 화면 배치. group_name(L1~L5)과 별개.';
COMMENT ON COLUMN public.luna_prompts.stage_order IS
  '같은 단계(또는 같은 부모) 안에서의 순서. 번호 n 또는 하위 알파벳.';
COMMENT ON COLUMN public.luna_prompts.parent_key IS
  '하위 단계이면 상위 luna_prompts.prompt_key. 예: type.find';

-- 단계·순서·부모 (title 은 아래 별도)
UPDATE public.luna_prompts AS p
SET
  stage = v.stage,
  stage_order = v.stage_order,
  parent_key = v.parent_key,
  updated_at = now()
FROM (
  VALUES
    ('identity.apollon', 1, 1, NULL::text),
    ('lens.space-planning', 2, 1, NULL),
    ('lens.space-design', 2, 2, NULL),
    ('lens.content-planning', 2, 3, NULL),
    ('lens.content-design', 2, 4, NULL),
    ('lens.hardware-design', 2, 5, NULL),
    ('lens.role', 2, 6, NULL),
    ('type.classify', 3, 1, NULL),
    ('type.know', 4, 1, NULL),
    ('type.find', 4, 2, NULL),
    ('search.keyword_extract', 4, 1, 'type.find'),
    ('source.workserver_structure', 4, 2, 'type.find'),
    ('eval.self', 4, 3, 'type.find'),
    ('search.requery', 4, 4, 'type.find'),
    ('answer.synthesis', 4, 5, 'type.find'),
    ('type.make', 4, 3, NULL),
    ('type.learn', 4, 4, NULL),
    ('talk.understand', 5, 1, NULL),
    ('talk.clarify_guard', 5, 1, 'talk.understand'),
    ('talk.assume', 5, 2, NULL),
    ('talk.answer', 5, 3, NULL),
    ('learn.capture', 6, 1, NULL),
    ('learn.dialogue', 6, 2, NULL),
    ('learn.selfstudy', 7, 1, NULL),
    ('self.upgrade', 7, 2, NULL),
    ('self.report', 7, 3, NULL)
) AS v(prompt_key, stage, stage_order, parent_key)
WHERE p.prompt_key = v.prompt_key;

-- 화면 title 만. prompt_key·content 유지.
UPDATE public.luna_prompts AS p
SET
  title = v.title,
  version = CASE WHEN p.title IS DISTINCT FROM v.title THEN p.version + 1 ELSE p.version END,
  updated_at = now()
FROM (
  VALUES
    ('identity.apollon', '아폴론 정체성'),
    ('lens.space-planning', '공간기획 관점'),
    ('lens.space-design', '공간디자인 관점'),
    ('lens.content-planning', '콘텐츠기획 관점'),
    ('lens.content-design', '콘텐츠디자인 관점'),
    ('lens.hardware-design', '하드웨어디자인 관점'),
    ('lens.role', '역할 관점'),
    ('type.classify', '유형 판정'),
    ('type.know', '알기 — 개념을 설명한다'),
    ('type.find', '찾기 — 자료를 찾는다'),
    ('type.make', '만들기 — 산출물을 만든다'),
    ('type.learn', '배우기 — 알려준 것을 받아 적는다'),
    ('talk.understand', '모호하면 되묻는다'),
    ('talk.assume', '가정을 밝힌다'),
    ('talk.answer', '답변 원칙'),
    ('learn.capture', '무엇을 배울지 고른다'),
    ('learn.dialogue', '후보를 두고 사람과 문답한다'),
    ('learn.selfstudy', '밤에 혼자 공부한다'),
    ('self.upgrade', '스스로를 고친다'),
    ('self.report', '한 주를 돌아본다'),
    ('search.keyword_extract', '검색어 만들기'),
    ('source.workserver_structure', 'Work서버 구조 이해'),
    ('eval.self', '충분한지 스스로 확인'),
    ('search.requery', '부족하면 다시 찾기'),
    ('answer.synthesis', '왜 이걸 보여주는지 설명')
) AS v(prompt_key, title)
WHERE p.prompt_key = v.prompt_key
  AND p.title IS DISTINCT FROM v.title;

INSERT INTO public.luna_prompt_versions (
  target_type, target_id, version, content, change_summary, changed_by, changed_by_luna
)
SELECT
  'prompt', p.id, p.version,
  jsonb_build_object(
    'title', p.title, 'description', p.description, 'purpose', p.purpose,
    'content', p.content, 'owner_id', p.owner_id, 'sort_order', p.sort_order
  ),
  '생각의 순서: 단계 배치·화면 제목 (본문 유지)',
  NULL, false
FROM public.luna_prompts p
WHERE p.prompt_key IN (
  'identity.apollon', 'lens.space-planning', 'lens.space-design',
  'lens.content-planning', 'lens.content-design', 'lens.hardware-design',
  'lens.role', 'type.classify', 'type.know', 'type.find', 'type.make',
  'type.learn', 'talk.understand', 'talk.assume', 'talk.answer',
  'learn.capture', 'learn.dialogue', 'learn.selfstudy', 'self.upgrade',
  'self.report', 'search.keyword_extract', 'source.workserver_structure',
  'eval.self', 'search.requery', 'answer.synthesis'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.luna_prompt_versions v
  WHERE v.target_id = p.id
    AND v.change_summary = '생각의 순서: 단계 배치·화면 제목 (본문 유지)'
);

COMMIT;
