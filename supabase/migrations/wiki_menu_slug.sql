-- 위키 개편 2/4 — category → menu_slug, 17건 재분류
-- 실행: 1/4 (wiki_menus.sql) 이후. 문서 본문은 건드리지 않는다.

BEGIN;

ALTER TABLE public.luna_library
  DROP CONSTRAINT IF EXISTS luna_library_category_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'luna_library'
      AND column_name = 'category'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'luna_library'
      AND column_name = 'menu_slug'
  ) THEN
    ALTER TABLE public.luna_library RENAME COLUMN category TO menu_slug;
  END IF;
END $$;

ALTER TABLE public.luna_library
  ADD COLUMN IF NOT EXISTS menu_slug text NOT NULL DEFAULT 'projects';

-- 제목으로 분류 (본문 미수정)
UPDATE public.luna_library SET menu_slug = 'projects'
WHERE title ILIKE '%광안리%'
   OR title ILIKE '%KCC 스위첸%'
   OR title ILIKE '%스위첸%'
   OR title ILIKE '%북한강%'
   OR title ILIKE '%스타벅스%'
   OR title ILIKE '%아시아미디어%'
   OR title ILIKE '%아시아 미디어%'
   OR title ILIKE '%LUNAR%'
   OR title ILIKE '%스타에비뉴%'
   OR title ILIKE '%트렌디%'
   OR title ILIKE '%유스타운%';

UPDATE public.luna_library SET menu_slug = 'business'
WHERE title ILIKE '%미디어 아키텍처%'
   OR title ILIKE '%미디어아키텍처%'
   OR title ILIKE '%미디어 스페이스%'
   OR title ILIKE '%미디어스페이스%'
   OR title ILIKE '%미디어 조형%'
   OR title ILIKE '%미디어조형%'
   OR title ILIKE '%미디어 콘텐츠%'
   OR title ILIKE '%미디어콘텐츠%';

UPDATE public.luna_library SET menu_slug = 'workflow'
WHERE title ILIKE '%견적%'
   OR title ILIKE '%계약%'
   OR title ILIKE '%RFP%'
   OR title ILIKE '%마스터플랜%'
   OR title ILIKE '%마스터 플랜%';

UPDATE public.luna_library SET menu_slug = 'identity'
WHERE title ILIKE '%정체성%'
   OR title ILIKE '%아폴론이 누구%';

UPDATE public.luna_library SET menu_slug = 'rules'
WHERE title ILIKE '%근태%'
   OR title ILIKE '%연차%'
   OR title ILIKE '%임금%'
   OR title ILIKE '%경비%'
   OR title ILIKE '%복지%'
   OR title ILIKE '%정보보안%'
   OR title ILIKE '%정보 보안%'
   OR title ILIKE '%괴롭힘%';

-- 제목에 안 걸린 옛 분류값만 (kind=policy 로 덮어쓰지 않음 — 정체성 문서 보호)
UPDATE public.luna_library SET menu_slug = 'workflow'
WHERE menu_slug = 'standards';

UPDATE public.luna_library SET menu_slug = 'projects'
WHERE menu_slug IN ('forms', 'form');

ALTER TABLE public.luna_library
  DROP CONSTRAINT IF EXISTS luna_library_menu_slug_fkey;
ALTER TABLE public.luna_library
  ADD CONSTRAINT luna_library_menu_slug_fkey
  FOREIGN KEY (menu_slug) REFERENCES public.luna_wiki_menus (slug);

DROP INDEX IF EXISTS luna_library_category_idx;
CREATE INDEX IF NOT EXISTS luna_library_menu_slug_idx
  ON public.luna_library (menu_slug, is_active, title);

COMMENT ON COLUMN public.luna_library.menu_slug IS
  'luna_wiki_menus.slug. 문서 주소와 무관 — 메뉴를 옮겨도 slug 는 그대로.';

COMMIT;
