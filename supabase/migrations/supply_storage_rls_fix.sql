-- supply-images Storage RLS 수정
-- 기존 supply-images 관련 정책 제거 후 재생성 (중복·충돌 방지)
-- Supabase SQL Editor에서 실행

insert into storage.buckets (id, name, public)
values ('supply-images', 'supply-images', true)
on conflict (id) do update set public = excluded.public;

-- 가능한 기존 정책명 모두 제거
drop policy if exists "supply_images_select" on storage.objects;
drop policy if exists "supply_images_insert_authenticated" on storage.objects;
drop policy if exists "supply_images_update_authenticated" on storage.objects;
drop policy if exists "supply_images_delete_authenticated" on storage.objects;
drop policy if exists "supply-images select" on storage.objects;
drop policy if exists "supply-images insert" on storage.objects;
drop policy if exists "supply-images update" on storage.objects;
drop policy if exists "supply-images delete" on storage.objects;
drop policy if exists "supply_images_public_select" on storage.objects;
drop policy if exists "Allow authenticated uploads supply-images" on storage.objects;
drop policy if exists "Allow public read supply-images" on storage.objects;

create policy "supply_images_select"
  on storage.objects for select
  using (bucket_id = 'supply-images');

create policy "supply_images_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'supply-images');

create policy "supply_images_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'supply-images')
  with check (bucket_id = 'supply-images');

create policy "supply_images_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'supply-images');
