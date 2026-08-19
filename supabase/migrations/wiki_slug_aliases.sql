-- 위키 개편 3/4 — slug 정리 + 옛 주소 별칭
-- 실행: 2/4 (wiki_menu_slug.sql) 이후.

BEGIN;

CREATE TABLE IF NOT EXISTS public.luna_wiki_slug_aliases (
  alias text PRIMARY KEY,
  slug text NOT NULL
);

COMMENT ON TABLE public.luna_wiki_slug_aliases IS
  '옛 문서 주소. /wiki/{alias} 와 /wiki/{옛분류}/{alias} 둘 다 새 slug 로 보낸다.';

-- 새 slug 계산: 밑줄→하이픈, project-/business- 접두어 제거, 지정 매핑
CREATE OR REPLACE FUNCTION public.wiki_canonical_slug(old text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(old))
    WHEN 'project-gwangan-kcc-switzen' THEN 'gwangan-kcc-switzen'
    WHEN 'project_gwangan_kcc_switzen' THEN 'gwangan-kcc-switzen'
    WHEN 'media-architecture-business' THEN 'media-architecture'
    WHEN 'media_architecture_business' THEN 'media-architecture'
    WHEN 'rfp_analysis' THEN 'rfp-analysis'
    WHEN 'ai_masterplan' THEN 'ai-masterplan'
    ELSE regexp_replace(
           regexp_replace(
             regexp_replace(lower(btrim(old)), '_', '-', 'g'),
             '^project-', ''),
           '^business-', '')
  END;
$$;

-- 별칭을 먼저 쌓고(옛 slug), 그다음 본 행 slug 를 바꾼다
INSERT INTO public.luna_wiki_slug_aliases (alias, slug)
SELECT l.slug, public.wiki_canonical_slug(l.slug)
FROM public.luna_library l
WHERE l.slug IS NOT NULL AND btrim(l.slug) <> ''
ON CONFLICT (alias) DO UPDATE SET slug = EXCLUDED.slug;

-- 밑줄 형태도 별칭
INSERT INTO public.luna_wiki_slug_aliases (alias, slug)
SELECT replace(l.slug, '-', '_'), public.wiki_canonical_slug(l.slug)
FROM public.luna_library l
WHERE l.slug LIKE '%-%'
ON CONFLICT (alias) DO UPDATE SET slug = EXCLUDED.slug;

UPDATE public.luna_library l
SET slug = public.wiki_canonical_slug(l.slug)
WHERE l.slug IS DISTINCT FROM public.wiki_canonical_slug(l.slug)
  AND NOT EXISTS (
    SELECT 1 FROM public.luna_library o
    WHERE o.slug = public.wiki_canonical_slug(l.slug)
      AND o.ctid <> l.ctid
  );

-- 별칭이 가리키는 slug 를 최신 값으로
UPDATE public.luna_wiki_slug_aliases a
SET slug = public.wiki_canonical_slug(a.slug);

-- 자기 자신을 가리키는 별칭(이미 새 slug 인 행)은 제거
DELETE FROM public.luna_wiki_slug_aliases
WHERE alias = slug;

ALTER TABLE public.luna_wiki_slug_aliases
  DROP CONSTRAINT IF EXISTS luna_wiki_slug_aliases_slug_fkey;
ALTER TABLE public.luna_wiki_slug_aliases
  ADD CONSTRAINT luna_wiki_slug_aliases_slug_fkey
  FOREIGN KEY (slug) REFERENCES public.luna_library (slug)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.luna_wiki_slug_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_wiki_slug_aliases_select_auth" ON public.luna_wiki_slug_aliases;
CREATE POLICY "luna_wiki_slug_aliases_select_auth"
  ON public.luna_wiki_slug_aliases FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS luna_wiki_slug_aliases_slug_idx
  ON public.luna_wiki_slug_aliases (slug);

COMMIT;
