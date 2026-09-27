-- Read-only metadata comparison, not proof of current physical file contents.
WITH inventory AS MATERIALIZED (
  SELECT DISTINCT ON (drive, path) drive, path, size_bytes, modified_at
  FROM public.nas_directory WHERE type = 'file'
  ORDER BY drive, path, scan_batch DESC
), checked AS (
  SELECT t.status, t.chunk_count, i.path AS current_path,
    t.size_bytes IS DISTINCT FROM i.size_bytes AS size_changed,
    t.modified_at IS DISTINCT FROM i.modified_at AS time_changed
  FROM public.nas_file_text t
  LEFT JOIN inventory i ON i.drive = t.drive AND i.path = t.path
)
SELECT status, count(*) AS text_files,
  count(*) FILTER (WHERE current_path IS NULL) AS missing_from_current_index,
  count(*) FILTER (WHERE current_path IS NOT NULL AND (size_changed OR time_changed)) AS metadata_changed,
  coalesce(sum(chunk_count) FILTER (WHERE current_path IS NULL), 0) AS chunks_for_missing_files
FROM checked GROUP BY status;
