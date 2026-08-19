-- 위키 개편 4/4 — 이미지 Storage 버킷
-- 실행: 블루진 (Supabase SQL Editor). 에이전트는 실행하지 않음.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wiki-media',
  'wiki-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "wiki_media_select" ON storage.objects;
CREATE POLICY "wiki_media_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'wiki-media');

DROP POLICY IF EXISTS "wiki_media_insert_authenticated" ON storage.objects;
CREATE POLICY "wiki_media_insert_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'wiki-media');

DROP POLICY IF EXISTS "wiki_media_update_authenticated" ON storage.objects;
CREATE POLICY "wiki_media_update_authenticated"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'wiki-media')
  WITH CHECK (bucket_id = 'wiki-media');

DROP POLICY IF EXISTS "wiki_media_delete_authenticated" ON storage.objects;
CREATE POLICY "wiki_media_delete_authenticated"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'wiki-media');

COMMIT;
