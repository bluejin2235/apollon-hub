-- 위키 개편 1/4 — 메뉴 테이블
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.

BEGIN;

CREATE TABLE IF NOT EXISTS public.luna_wiki_menus (
  slug text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  editable_by text NOT NULL DEFAULT 'all'
    CHECK (editable_by IN ('all', 'admin')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.luna_wiki_menus IS
  '위키 사이드바 메뉴. 코드 수정 없이 추가·숨김·순서 변경.';

INSERT INTO public.luna_wiki_menus (slug, name, description, editable_by, sort_order, is_active)
VALUES
  ('projects', '프로젝트 사례', '우리가 한 일. 무엇을 만들었고 무엇을 배웠나', 'all', 10, true),
  ('business', '사업 영역', '아폴론이 하는 일의 범위', 'all', 20, true),
  ('workflow', '일하는 방식', '견적·계약·분석처럼 반복하는 방법', 'all', 30, true),
  ('identity', '회사 기준', '우리가 누구이고 무엇을 지키는가', 'all', 40, true),
  ('rules', '인사·규정', '아폴론이 지키는 규칙. 바뀌면 전원에게 알림이 갑니다', 'admin', 50, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  editable_by = EXCLUDED.editable_by,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

ALTER TABLE public.luna_wiki_menus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_wiki_menus_select_auth" ON public.luna_wiki_menus;
CREATE POLICY "luna_wiki_menus_select_auth"
  ON public.luna_wiki_menus FOR SELECT
  TO authenticated
  USING (true);

COMMIT;
