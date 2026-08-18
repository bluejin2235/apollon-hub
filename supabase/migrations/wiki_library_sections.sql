-- Apollon Wikipedia — content → sections 변환 (2/4)
-- 실행: 블루진. 1/4 (wiki_library_columns.sql) 이후.

BEGIN;

CREATE OR REPLACE FUNCTION public.wiki_content_to_sections(src text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized text;
  lines text[];
  line text;
  heading text;
  sections jsonb := '[]'::jsonb;
  cur_title text := NULL;
  cur_body text := '';
  n int := 0;
  has_heading boolean := false;
BEGIN
  IF src IS NULL OR btrim(src) = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  normalized := replace(src, E'\r\n', E'\n');
  has_heading := normalized ~ '(^|\n)#{1,3}[[:space:]]+';

  IF NOT has_heading THEN
    RETURN jsonb_build_array(
      jsonb_build_object('id', 's1', 'title', '본문', 'body', btrim(normalized))
    );
  END IF;

  lines := string_to_array(normalized, E'\n');
  FOREACH line IN ARRAY lines LOOP
    heading := NULL;
    IF line ~ '^#{1,3}[[:space:]]+' THEN
      heading := btrim(regexp_replace(line, '^#{1,3}[[:space:]]+', ''));
    END IF;

    IF heading IS NOT NULL AND heading <> '' THEN
      IF cur_title IS NOT NULL OR btrim(cur_body) <> '' THEN
        n := n + 1;
        sections := sections || jsonb_build_array(
          jsonb_build_object(
            'id', 's' || n,
            'title', COALESCE(cur_title, '본문'),
            'body', btrim(cur_body)
          )
        );
      END IF;
      cur_title := heading;
      cur_body := '';
    ELSE
      IF cur_body = '' THEN
        cur_body := line;
      ELSE
        cur_body := cur_body || E'\n' || line;
      END IF;
    END IF;
  END LOOP;

  n := n + 1;
  sections := sections || jsonb_build_array(
    jsonb_build_object(
      'id', 's' || n,
      'title', COALESCE(cur_title, '본문'),
      'body', btrim(cur_body)
    )
  );
  RETURN sections;
END;
$$;

UPDATE public.luna_library
SET category = 'standards'
WHERE category = 'forms'
  AND (slug = 'rfp_analysis' OR kind IN ('analysis', 'tone'));

UPDATE public.luna_library
SET category = 'rules'
WHERE category = 'forms' AND kind = 'policy';

UPDATE public.luna_library
SET sections = public.wiki_content_to_sections(content)
WHERE jsonb_typeof(sections) IS DISTINCT FROM 'array'
   OR jsonb_array_length(sections) = 0;

UPDATE public.luna_library
SET
  version = GREATEST(version, 1),
  history = CASE
    WHEN jsonb_typeof(history) = 'array' AND jsonb_array_length(history) > 0
      THEN history
    ELSE jsonb_build_array(
      jsonb_build_object(
        'version', 1,
        'at', COALESCE(updated_at, created_at, now()),
        'by', NULL,
        'by_name', '이관',
        'summary', '위키로 이관',
        'added', 0,
        'removed', 0,
        'title', title,
        'kind', kind,
        'summary_text', summary,
        'related', COALESCE(related, '[]'::jsonb),
        'sections', sections
      )
    )
  END
WHERE jsonb_typeof(history) IS NULL
   OR jsonb_typeof(history) <> 'array'
   OR jsonb_array_length(history) = 0;

COMMIT;
