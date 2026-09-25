-- Read-only. A missing index path is an investigation candidate, not proof of deletion.
-- Run after a confirmed complete scan; never auto-delete based on this count alone.
WITH current_paths AS (
  SELECT DISTINCT lower(regexp_replace(
    upper(drive) || ':' || chr(92) || replace(path, '/', chr(92)),
    E'\\\\+', chr(92), 'g'
  )) AS full_path
  FROM public.nas_directory
), linked AS (
  SELECT lower(regexp_replace(replace(from_id, '/', chr(92)),
    E'\\\\+', chr(92), 'g')) AS full_path
  FROM public.luna_links
  WHERE status = 'active' AND from_type = 'nas_path' AND kind = 'belongs'
)
SELECT count(*) AS active_memberships,
  count(*) FILTER (WHERE c.full_path IS NULL) AS paths_not_in_normalized_index
FROM linked l LEFT JOIN current_paths c USING (full_path);

SELECT status, kind, count(*) AS link_count,
  min(confidence) AS min_confidence, max(confidence) AS max_confidence
FROM public.luna_links GROUP BY status, kind ORDER BY status, kind;
