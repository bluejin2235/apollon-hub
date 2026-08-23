-- luna_media_favorites — 이미지 즐겨찾기 (실행하지 마라, 제시만)
-- modal_path_tab — 이미지 모달 경로 탭 기억 (localStorage 아님)

CREATE TABLE IF NOT EXISTS public.luna_media_favorites (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path)
);

CREATE INDEX IF NOT EXISTS luna_media_favorites_user_idx
  ON public.luna_media_favorites (user_id);

ALTER TABLE public.luna_media_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_media_favorites_select_own" ON public.luna_media_favorites;
CREATE POLICY "luna_media_favorites_select_own"
  ON public.luna_media_favorites FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "luna_media_favorites_insert_own" ON public.luna_media_favorites;
CREATE POLICY "luna_media_favorites_insert_own"
  ON public.luna_media_favorites FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "luna_media_favorites_delete_own" ON public.luna_media_favorites;
CREATE POLICY "luna_media_favorites_delete_own"
  ON public.luna_media_favorites FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.luna_media_favorites TO authenticated;
GRANT ALL ON public.luna_media_favorites TO service_role;

ALTER TABLE public.luna_nas_path_settings
  ADD COLUMN IF NOT EXISTS modal_path_tab text
  CHECK (modal_path_tab IS NULL OR modal_path_tab IN ('office', 'custom', 'unc'));
