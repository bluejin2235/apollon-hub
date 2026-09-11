-- 문의 게시판 RLS. Hub SQL Editor 에서 실행하세요. 에이전트는 실행하지 않습니다.
-- 로그인한 사람은 다 읽는다. 쓰기는 본인 것만. 상태·담당자 변경은 슈퍼관리자와 담당자만.

BEGIN;

-- seq 는 IDENTITY 로 이미 붙었습니다. 앱은 seq 를 넣지 않습니다.
GRANT USAGE, SELECT ON SEQUENCE public.issues_seq_seq TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS issues_seq_key ON public.issues (seq);

CREATE OR REPLACE FUNCTION public.is_hub_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = '슈퍼관리자'
  );
$$;

REVOKE ALL ON FUNCTION public.is_hub_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_hub_super_admin() TO authenticated;

-- issues
DROP POLICY IF EXISTS issues_select_auth ON public.issues;
CREATE POLICY issues_select_auth
  ON public.issues FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS issues_insert_own ON public.issues;
CREATE POLICY issues_insert_own
  ON public.issues FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS issues_update_own_or_manage ON public.issues;
CREATE POLICY issues_update_own_or_manage
  ON public.issues FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR assignee_id = auth.uid()
    OR public.is_hub_super_admin()
  )
  WITH CHECK (
    author_id = auth.uid()
    OR assignee_id = auth.uid()
    OR public.is_hub_super_admin()
  );

DROP POLICY IF EXISTS issues_delete_own ON public.issues;
CREATE POLICY issues_delete_own
  ON public.issues FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_hub_super_admin());

-- 상태·담당자는 슈퍼관리자·담당자만. 본문 수정은 올린 사람만.
CREATE OR REPLACE FUNCTION public.issues_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  admin := public.is_hub_super_admin();

  IF NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.seq IS DISTINCT FROM OLD.seq THEN
    RAISE EXCEPTION '작성자·번호는 바꿀 수 없습니다';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    IF NOT (admin OR OLD.assignee_id = auth.uid()) THEN
      RAISE EXCEPTION '상태·담당자는 슈퍼관리자와 담당자만 바꿀 수 있습니다';
    END IF;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.area IS DISTINCT FROM OLD.area THEN
    IF NOT (admin OR OLD.author_id = auth.uid()) THEN
      RAISE EXCEPTION '본문은 올린 사람만 고칩니다';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issues_guard_update ON public.issues;
CREATE TRIGGER issues_guard_update
  BEFORE UPDATE ON public.issues
  FOR EACH ROW
  EXECUTE FUNCTION public.issues_guard_update();

-- issue_comments
DROP POLICY IF EXISTS issue_comments_select_auth ON public.issue_comments;
CREATE POLICY issue_comments_select_auth
  ON public.issue_comments FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS issue_comments_insert_own ON public.issue_comments;
CREATE POLICY issue_comments_insert_own
  ON public.issue_comments FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS issue_comments_update_own ON public.issue_comments;
CREATE POLICY issue_comments_update_own
  ON public.issue_comments FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS issue_comments_delete_own ON public.issue_comments;
CREATE POLICY issue_comments_delete_own
  ON public.issue_comments FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_hub_super_admin());

-- issue_events : 읽기는 모두, 쓰기는 슈퍼관리자·그 문의 담당자
DROP POLICY IF EXISTS issue_events_select_auth ON public.issue_events;
CREATE POLICY issue_events_select_auth
  ON public.issue_events FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS issue_events_insert_manage ON public.issue_events;
CREATE POLICY issue_events_insert_manage
  ON public.issue_events FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.is_hub_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.issues i
        WHERE i.id = issue_id AND i.assignee_id = auth.uid()
      )
    )
  );

-- issue_watchers : 읽기는 모두, 쓰기는 본인
DROP POLICY IF EXISTS issue_watchers_select_auth ON public.issue_watchers;
CREATE POLICY issue_watchers_select_auth
  ON public.issue_watchers FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS issue_watchers_insert_own ON public.issue_watchers;
CREATE POLICY issue_watchers_insert_own
  ON public.issue_watchers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS issue_watchers_delete_own ON public.issue_watchers;
CREATE POLICY issue_watchers_delete_own
  ON public.issue_watchers FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;
