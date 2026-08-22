-- luna_media_index — Work서버 이미지 색인 (실행하지 마라, 제시만)
-- HNSW 인덱스는 대량 삽입 완료 후 별도 migration 으로 추가

CREATE TABLE IF NOT EXISTS public.luna_media_index (
  path text PRIMARY KEY,
  drive text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('image', 'design')),
  file_size bigint NOT NULL,
  width int,
  height int,
  file_mtime timestamptz NOT NULL,

  project text,
  stage text,
  author text,
  folder_category text,
  ai_category text CHECK (ai_category IN ('ours', 'reference', 'document', 'unknown')),
  purpose text,

  description text,
  description_model text,
  thumbnail_url text,
  embedding vector(1536),
  content_hash text,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luna_media_index_drive_idx
  ON public.luna_media_index (drive);

CREATE INDEX IF NOT EXISTS luna_media_index_project_idx
  ON public.luna_media_index (project);

-- Storage bucket (Supabase Dashboard 또는 별도 script)
-- 이름: luna-media-thumbs
-- public read (또는 signed URL 정책은 Hub 연동 시 결정)

-- HNSW (삽입 후):
-- CREATE INDEX luna_media_index_embedding_hnsw
--   ON public.luna_media_index USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.luna_media_index ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.luna_media_index TO authenticated;
GRANT ALL ON public.luna_media_index TO service_role;
