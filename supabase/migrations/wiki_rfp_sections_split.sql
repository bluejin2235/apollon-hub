-- RFP분석 절 분리. 평문 소제목이라 wiki_content_to_sections 가 한 절로 묶은 것을 고친다.
-- 실행: 블루진. 새 테이블 없음. 판(version)은 올리지 않는다.
-- 절: 목적 / 입력 처리 / 절차 / 근거 규칙 / 출력 형식

BEGIN;

WITH src AS (
  SELECT
    slug,
    regexp_replace(
      regexp_replace(
        COALESCE(
          (
            SELECT s.value->>'body'
            FROM jsonb_array_elements(sections) WITH ORDINALITY AS s(value, ord)
            WHERE jsonb_array_length(sections) = 1
            LIMIT 1
          ),
          content
        ),
        E'\r\n', E'\n', 'g'
      ),
      E'^## 본문[ \t]*\n',
      ''
    ) AS body
  FROM public.luna_library
  WHERE slug = 'rfp_analysis'
),
prefixed AS (
  SELECT
    slug,
    CASE
      WHEN body ~ '(^|\n)목적[ \t]*(\n|$)' THEN body
      ELSE '목적' || E'\n' || body
    END AS body
  FROM src
),
headed AS (
  SELECT
    slug,
    regexp_replace(
      body,
      E'(?n)^(목적|입력 처리|절차|근거 규칙|출력 형식)[ \t]*$',
      E'## \\1',
      'g'
    ) AS md
  FROM prefixed
),
split AS (
  SELECT
    slug,
    public.wiki_content_to_sections(md) AS sections,
    md
  FROM headed
)
UPDATE public.luna_library l
SET
  sections = s.sections,
  content = (
    SELECT string_agg(
      '## ' || COALESCE(x.value->>'title', '절') || E'\n' || COALESCE(x.value->>'body', ''),
      E'\n\n'
      ORDER BY x.ordinality
    )
    FROM jsonb_array_elements(s.sections) WITH ORDINALITY AS x(value, ordinality)
  ),
  updated_by_name = CASE
    WHEN l.updated_by IS NULL THEN '위키로 옮겨짐'
    ELSE l.updated_by_name
  END
FROM split s
WHERE l.slug = s.slug
  AND jsonb_array_length(s.sections) >= 2;

UPDATE public.luna_library
SET history = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN COALESCE(e->>'by', '') = '' THEN
        e || jsonb_build_object(
          'by_name', '위키로 옮겨짐',
          'sections', CASE
            WHEN COALESCE((e->>'version')::int, 0) = 1 THEN sections
            ELSE COALESCE(e->'sections', '[]'::jsonb)
          END
        )
      ELSE e
    END
    ORDER BY COALESCE((e->>'version')::int, 0) DESC
  )
  FROM jsonb_array_elements(history) e
), history)
WHERE slug = 'rfp_analysis'
  AND jsonb_typeof(history) = 'array';

COMMIT;
