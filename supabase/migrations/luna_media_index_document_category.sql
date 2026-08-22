-- luna_media_index ai_category 에 document 추가 (실행하지 마라)
-- ours | reference | document | unknown

ALTER TABLE public.luna_media_index
  DROP CONSTRAINT IF EXISTS luna_media_index_ai_category_check;

ALTER TABLE public.luna_media_index
  ADD CONSTRAINT luna_media_index_ai_category_check
  CHECK (ai_category IN ('ours', 'reference', 'document', 'unknown'));
