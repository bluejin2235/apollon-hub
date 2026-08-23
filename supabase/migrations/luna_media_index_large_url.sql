-- luna_media_index — 1200px 확대 보기 URL (실행하지 마라, 제시만)
-- width · height 는 원본 픽셀 크기 (기존 컬럼, 변경 없음)

ALTER TABLE public.luna_media_index
  ADD COLUMN IF NOT EXISTS large_url text;

COMMENT ON COLUMN public.luna_media_index.large_url IS
  '1200px fit-inside webp — Supabase Storage public URL (크게 보기)';

COMMENT ON COLUMN public.luna_media_index.width IS
  '원본 이미지 너비(px). Work서버 원본 sharp metadata';

COMMENT ON COLUMN public.luna_media_index.height IS
  '원본 이미지 높이(px). Work서버 원본 sharp metadata';
