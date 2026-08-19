-- 루나·위키 베타 접근 목록 (원격에 이미 있으면 IF NOT EXISTS)
-- 앱은 service role API로 쓰고, 본인 행 SELECT 는 허브 링크 표시용.

CREATE TABLE IF NOT EXISTS public.luna_beta_access (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.luna_beta_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "luna_beta_access_select_auth" ON public.luna_beta_access;
CREATE POLICY "luna_beta_access_select_auth"
  ON public.luna_beta_access FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.luna_beta_access TO authenticated;
GRANT ALL ON public.luna_beta_access TO service_role;
