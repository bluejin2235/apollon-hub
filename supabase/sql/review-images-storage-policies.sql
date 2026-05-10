-- review-images Storage RLS — menu-images와 동일 패턴으로 맞출 때 SQL Editor에서 실행

insert into storage.buckets (id, name, public)
values ('review-images', 'review-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "review_images_select" on storage.objects;
create policy "review_images_select"
  on storage.objects for select
  using (bucket_id = 'review-images');

drop policy if exists "review_images_insert_authenticated" on storage.objects;
create policy "review_images_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'review-images');

drop policy if exists "review_images_update_authenticated" on storage.objects;
create policy "review_images_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'review-images')
  with check (bucket_id = 'review-images');

drop policy if exists "review_images_delete_authenticated" on storage.objects;
create policy "review_images_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'review-images');
