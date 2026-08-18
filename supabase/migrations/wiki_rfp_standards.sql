-- Apollon Wikipedia — rfp_analysis 를 기준으로 옮김 (3/4)
-- 실행: 블루진. 2/4 이후. 이미 2/4 에서 category/sections 를 채웠으면 멱등.

BEGIN;

UPDATE public.luna_library
SET
  category = 'standards',
  kind = CASE WHEN kind IS NULL OR kind = '' THEN 'analysis' ELSE kind END,
  summary = CASE
    WHEN btrim(COALESCE(summary, '')) <> '' THEN summary
    ELSE 'RFP·제안 요청을 읽을 때 쓰는 분석 기준'
  END,
  sections = CASE
    WHEN jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) > 0
      THEN sections
    ELSE public.wiki_content_to_sections(content)
  END,
  content = CASE
    WHEN btrim(COALESCE(content, '')) <> '' THEN content
    ELSE (
      SELECT string_agg('## ' || (s->>'title') || E'\n' || COALESCE(s->>'body', ''), E'\n\n')
      FROM jsonb_array_elements(sections) s
    )
  END,
  updated_at = now()
WHERE slug = 'rfp_analysis';

COMMENT ON TABLE public.luna_library IS
  'Apollon Wikipedia 문서(양식·기준·규정). MAKE 가 양식/기준을 읽는다. 용어사전은 glossary_terms.';

COMMIT;
