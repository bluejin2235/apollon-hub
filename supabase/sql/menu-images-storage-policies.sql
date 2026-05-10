-- menu-images Storage RLS — Supabase SQL Editor에서 실행
-- review-images와 동일한 패턴(authenticated INSERT/SELECT + upsert 대비 UPDATE/DELETE)
-- 400/403 업로드 오류 시 버킷·정책 누락 여부를 점검할 때 사용합니다.

-- 버킷 공개 읽기(URL 직링크)
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "menu_images_select" on storage.objects;
create policy "menu_images_select"
  on storage.objects for select
  using (bucket_id = 'menu-images');

drop policy if exists "menu_images_insert_authenticated" on storage.objects;
create policy "menu_images_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'menu-images');

drop policy if exists "menu_images_update_authenticated" on storage.objects;
create policy "menu_images_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'menu-images')
  with check (bucket_id = 'menu-images');

drop policy if exists "menu_images_delete_authenticated" on storage.objects;
create policy "menu_images_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'menu-images');
