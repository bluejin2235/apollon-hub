-- luna_match_media — 이미지 색인 임베딩 유사도 검색
-- 적용은 수동. 이 파일만 제시하고 자동 실행하지 않음.

CREATE OR REPLACE FUNCTION public.luna_match_media(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.33,
  match_count integer DEFAULT 12
)
RETURNS TABLE(
  path text,
  drive text,
  file_name text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT sub.path, sub.drive, sub.file_name, sub.similarity
  FROM (
    SELECT
      m.path,
      m.drive,
      m.file_name,
      (1 - (m.embedding <=> query_embedding))::double precision AS similarity
    FROM public.luna_media_index m
    WHERE m.embedding IS NOT NULL
    ORDER BY m.embedding <=> query_embedding
    LIMIT greatest(match_count * 4, 48)
  ) sub
  WHERE sub.similarity >= match_threshold
  ORDER BY sub.similarity DESC
  LIMIT greatest(match_count, 1);
$$;

COMMENT ON FUNCTION public.luna_match_media IS
  'Work서버 이미지 색인(luna_media_index) 코사인 유사도 검색. LLM 없음.';
