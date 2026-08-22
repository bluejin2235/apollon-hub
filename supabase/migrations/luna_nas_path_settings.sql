-- Work서버 경로 표기 — 사용자별 접두사 (profiles 와 분리)
-- 이유: PC마다 RaiDrive 드라이브 문자·마운트가 달라 profiles(HR)와 분리해 RLS 로 본인만 수정

CREATE TABLE IF NOT EXISTS public.luna_nas_path_settings (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  display_mode text NOT NULL DEFAULT 'office'
    CHECK (display_mode IN ('office', 'custom', 'unc')),
  prefix_t text NOT NULL DEFAULT '',
  prefix_p text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.luna_nas_path_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_nas_path_settings_select_own" ON public.luna_nas_path_settings;
CREATE POLICY "luna_nas_path_settings_select_own"
  ON public.luna_nas_path_settings FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "luna_nas_path_settings_insert_own" ON public.luna_nas_path_settings;
CREATE POLICY "luna_nas_path_settings_insert_own"
  ON public.luna_nas_path_settings FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "luna_nas_path_settings_update_own" ON public.luna_nas_path_settings;
CREATE POLICY "luna_nas_path_settings_update_own"
  ON public.luna_nas_path_settings FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.luna_nas_path_settings TO authenticated;
GRANT ALL ON public.luna_nas_path_settings TO service_role;
