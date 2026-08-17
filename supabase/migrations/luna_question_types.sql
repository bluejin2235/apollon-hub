-- 유형 판정 도입 (설계 8~10장)
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.
-- 원칙: 기존 luna_prompts 행 삭제 금지. 폐기는 is_active=false.
-- 순서: 1 테이블 → 2 유형 시드 → 3 프롬프트 신설 → 4 흡수·이관 → 5 커밋

BEGIN;

-- ── 1. 테이블 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.luna_question_types (
  slug text PRIMARY KEY,
  label text NOT NULL,
  criteria text NOT NULL DEFAULT '',
  sources text NOT NULL DEFAULT '',
  answer_form text NOT NULL DEFAULT '',
  prompt_key text,
  needs_search boolean NOT NULL DEFAULT false,
  needs_library boolean NOT NULL DEFAULT false,
  skip_clarify boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.luna_question_types IS
  '질문 유형. 판정 기준·소스·답변 형태·검색 여부는 이 표만 본다. 코드에 slug 를 하드코딩하지 않는다.';

ALTER TABLE public.luna_question_types ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.luna_question_types TO service_role;

CREATE TABLE IF NOT EXISTS public.luna_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'template',
  content text NOT NULL DEFAULT '',
  source_prompt_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.luna_library IS
  'MAKE 양식·분석 템플릿. task.rfp 는 rfp_analysis 로 이관.';

ALTER TABLE public.luna_library ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.luna_library TO service_role;

CREATE TABLE IF NOT EXISTS public.luna_unclassified_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  types text[] NOT NULL DEFAULT '{}',
  reason text,
  confidence numeric,
  conversation_id uuid,
  status text NOT NULL DEFAULT 'pending',
  promoted_slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.luna_unclassified_questions IS
  '유형 판정 실패·저신뢰 질문. 두뇌>유형 에서 새 유형 후보로 삼는다.';

ALTER TABLE public.luna_unclassified_questions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.luna_unclassified_questions TO service_role;

CREATE INDEX IF NOT EXISTS luna_unclassified_questions_status_idx
  ON public.luna_unclassified_questions (status, created_at DESC);

-- ── 2. 유형 시드 ──────────────────────────────────────────
INSERT INTO public.luna_question_types (
  slug, label, criteria, sources, answer_form, prompt_key,
  needs_search, needs_library, skip_clarify, is_active, sort_order
) VALUES
(
  'know', '알기',
  '개념·용어·프로세스·역할·차이를 묻는 질문. 자료를 찾거나 만들지 않는다.',
  '기억(확정 지식), 일반 지식. 검색 없음.',
  '정의 먼저, 아폴론 맥락이 있으면 한 줄.',
  'type.know', false, false, true, true, 1
),
(
  'find', '찾기',
  '파일·페이지·경로·자료의 위치나 원본을 찾는 질문. ''어디'', ''찾아줘'', ''자료''.',
  'Work서버, 노션, 필요 시 웹.',
  '실측 경로와 근거 링크. 추측 경로 금지.',
  'type.find', true, false, false, true, 2
),
(
  'make', '만들기',
  '체크리스트·초안·양식·산출물을 만들어 달라는 요청.',
  'luna_library 양식. 없으면 되물음.',
  '바로 쓸 수 있는 산출물. 양식 없으면 되물음.',
  'type.make', false, true, false, true, 3
),
(
  'learn', '배우기',
  '사용자가 사실·용어·별칭을 알려주거나 정정한다.',
  '이 턴의 사용자 발화. 검색 없음.',
  '내용을 재진술하고 후보로 남긴다고 알린다.',
  'type.learn', false, false, true, true, 4
),
(
  'smalltalk', '인사',
  '인사, 감사, 잡담. 업무 질문이 아님.',
  '없음.',
  '짧게 받아친다. 검색하지 않는다.',
  NULL, false, false, true, true, 5
)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  criteria = EXCLUDED.criteria,
  sources = EXCLUDED.sources,
  answer_form = EXCLUDED.answer_form,
  prompt_key = EXCLUDED.prompt_key,
  needs_search = EXCLUDED.needs_search,
  needs_library = EXCLUDED.needs_library,
  skip_clarify = EXCLUDED.skip_clarify,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ── 3. 프롬프트 신설 (내용은 살리고 배치는 유형별) ────────
INSERT INTO public.luna_prompts (
  level, kind, prompt_key, group_name, title, description, purpose, content,
  is_active, sort_order, version
)
VALUES
(
  'L3', 'system', 'type.classify', 'L3', '유형 판정',
  '매 턴 질문을 유형 표와 대조한다. 유형 목록은 DB에서 붙인다.',
  '검색·되묻기 전에 유형을 정한다',
  $type_classify$질문을 아래 유형 목록과 대조해 판정한다. 복수 가능하다.
목록에 없는 slug 는 쓰지 않는다.

JSON만 응답:
{"types":["know"],"reason":"한 줄 근거","confidence":0.0}

규칙
- confidence 는 0~1.
- 확신이 낮으면 가장 가까운 1개만 넣고 confidence 를 0.5 미만으로 둔다.
- 설명과 찾기가 한 문장에 있으면 둘 다 넣는다.$type_classify$,
  true, 9, 1
),
(
  'L3', 'system', 'type.know', 'L3', 'KNOW 답변',
  '알기 유형 답변. 검색 없이 개념을 설명한다.',
  'KNOW 경로 답변 생성',
  $type_know$개념·용어·프로세스·역할을 설명한다.
지금은 검색하지 않은 상태다. 기억(확정 지식)과 일반 지식으로 답한다.
핵심 정의 먼저. 아폴론 맥락이 있으면 한 줄로 연결한다.
경로·파일명을 추측하지 않는다.
talk.answer 의 답변 원칙과 충돌하지 않는다.$type_know$,
  true, 6, 1
),
(
  'L3', 'system', 'type.make', 'L3', 'MAKE 답변',
  '만들기 유형 답변. 양식이 없으면 되묻는다.',
  'MAKE 경로 답변 생성',
  $type_make$산출물·양식·초안을 만든다.
라이브러리에 맞는 양식이 있으면 그 구조를 따른다.
양식이 없으면 만들기 전에 되묻는다. 없는 양식을 지어내지 않는다.
결과는 바로 쓸 수 있는 짧게.
talk.answer 의 답변 원칙과 충돌하지 않는다.$type_make$,
  true, 7, 1
),
(
  'L3', 'system', 'type.learn', 'L3', 'LEARN 답변',
  '배우기 유형 답변. 알려준 사실을 후보로 남긴다.',
  'LEARN 경로 답변 생성',
  $type_learn$사용자가 알려준 사실을 받아 적는다.
맞장구보다 내용을 정확히 재진술한다.
"기억에 남기겠다"고 하되, 확정된 것처럼 단정하지 않는다. 후보다.
검색하거나 반박하지 않는다.
talk.answer 의 답변 원칙과 충돌하지 않는다.$type_learn$,
  true, 8, 1
)
ON CONFLICT (prompt_key) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  purpose = EXCLUDED.purpose,
  content = EXCLUDED.content,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  version = public.luna_prompts.version + 1,
  updated_at = now();

INSERT INTO public.luna_prompt_versions (
  target_type, target_id, version, content, change_summary, changed_by, changed_by_luna
)
SELECT
  'prompt', p.id, p.version,
  jsonb_build_object(
    'title', p.title, 'description', p.description, 'purpose', p.purpose,
    'content', p.content, 'owner_id', p.owner_id, 'sort_order', p.sort_order
  ),
  '유형 판정 도입: type.* 신설',
  NULL, false
FROM public.luna_prompts p
WHERE p.prompt_key IN ('type.classify', 'type.know', 'type.make', 'type.learn');

-- ── 4. 흡수·이관 (삭제 금지) ──────────────────────────────
-- talk.search → type.find 로 이미 흡수. 비활성만.
UPDATE public.luna_prompts
SET is_active = false, version = version + 1, updated_at = now()
WHERE prompt_key = 'talk.search'
  AND is_active = true;

INSERT INTO public.luna_prompt_versions (
  target_type, target_id, version, content, change_summary, changed_by, changed_by_luna
)
SELECT
  'prompt', p.id, p.version,
  jsonb_build_object(
    'title', p.title, 'description', p.description, 'purpose', p.purpose,
    'content', p.content, 'owner_id', p.owner_id, 'sort_order', p.sort_order
  ),
  'type.find 로 흡수. 원본 보존, 비활성',
  NULL, false
FROM public.luna_prompts p
WHERE p.prompt_key = 'talk.search';

-- task.rfp → luna_library.rfp_analysis 이관 후 비활성
INSERT INTO public.luna_library (slug, title, kind, content, source_prompt_key, is_active)
SELECT
  'rfp_analysis',
  COALESCE(NULLIF(p.title, ''), 'RFP분석'),
  'analysis',
  p.content,
  'task.rfp',
  true
FROM public.luna_prompts p
WHERE p.prompt_key = 'task.rfp'
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  source_prompt_key = EXCLUDED.source_prompt_key,
  updated_at = now();

UPDATE public.luna_prompts
SET is_active = false, version = version + 1, updated_at = now()
WHERE prompt_key = 'task.rfp'
  AND is_active = true;

INSERT INTO public.luna_prompt_versions (
  target_type, target_id, version, content, change_summary, changed_by, changed_by_luna
)
SELECT
  'prompt', p.id, p.version,
  jsonb_build_object(
    'title', p.title, 'description', p.description, 'purpose', p.purpose,
    'content', p.content, 'owner_id', p.owner_id, 'sort_order', p.sort_order
  ),
  'luna_library.rfp_analysis 로 이관. 원본 보존, 비활성',
  NULL, false
FROM public.luna_prompts p
WHERE p.prompt_key = 'task.rfp';

COMMIT;
