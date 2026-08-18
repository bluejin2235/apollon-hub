-- Apollon Wikipedia — sections → content 캐시 맞춤 (4/4)
-- 실행: 블루진. MAKE 주입은 content 컬럼을 쓴다.

BEGIN;

UPDATE public.luna_library
SET content = COALESCE(
  (
    SELECT string_agg(
      '## ' || COALESCE(s.value->>'title', '절') || E'\n' || COALESCE(s.value->>'body', ''),
      E'\n\n'
      ORDER BY s.ordinality
    )
    FROM jsonb_array_elements(sections) WITH ORDINALITY AS s(value, ordinality)
  ),
  content,
  ''
)
WHERE jsonb_typeof(sections) = 'array'
  AND jsonb_array_length(sections) > 0;

COMMIT;
