-- supplies INSERT RLS 완화: 인증된 모든 멤버가 비품 등록 가능
-- 적용: Supabase SQL Editor 또는 migration 파이프라인
--
-- 배경:
--   기존 정책 "supplies_insert_manager" 는 슈퍼관리자/중간관리자만 INSERT 허용.
--   단계 4-A 에서 앱(canCreateSupply)이 "인증된 모든 멤버 등록 가능" 으로 바뀌었으므로
--   RLS 도 동일하게 완화한다.
--
-- 참고: supplies 테이블에는 registered_by/created_by 같은 "등록자" 컬럼이 없다.
--   (컬럼: id, code, name, location_id, quantity, manager_id, description,
--    components, image_paths, status, created_at)
--   따라서 registered_by = auth.uid() 자기소유 체크는 적용할 수 없고,
--   인증 사용자 전체 허용(with check true)으로 둔다.
--   조회는 supplies_select_auth(true), 수정/삭제는 기존 정책이 별도로 제한한다.

drop policy if exists "supplies_insert_manager" on public.supplies;
drop policy if exists "supplies_insert_authenticated" on public.supplies;

create policy "supplies_insert_authenticated"
  on public.supplies
  for insert
  to authenticated
  with check (true);
