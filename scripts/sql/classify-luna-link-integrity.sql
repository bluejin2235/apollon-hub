-- Read-only candidate classification. Filename matches never prove identity or deletion.
-- Materialize/group once: do not run a correlated full-index scan for each link.
WITH current_paths AS MATERIALIZED (
  SELECT DISTINCT lower(regexp_replace(
    upper(rtrim(drive, ':')) || ':/' || ltrim(translate(path, chr(92), '/'), '/'),
    '/+', '/', 'g')) AS full_path
  FROM public.nas_directory
), current_names AS MATERIALIZED (
  SELECT full_path, split_part(full_path, ':', 1) AS drive,
    regexp_replace(full_path, '^.*/', '') AS filename
  FROM current_paths
), names_by_drive AS (
  SELECT drive, filename, count(*) AS candidates
  FROM current_names GROUP BY drive, filename
), names_all AS (
  SELECT filename, count(*) AS candidates FROM current_names GROUP BY filename
), linked AS MATERIALIZED (
  SELECT id, lower(regexp_replace(translate(from_id, chr(92), '/'), '/+', '/', 'g')) AS full_path
  FROM public.luna_links
  WHERE status = 'active' AND from_type = 'nas_path' AND kind = 'belongs'
), missing AS (
  SELECT l.*, split_part(l.full_path, ':', 1) AS drive,
    regexp_replace(l.full_path, '^.*/', '') AS filename
  FROM linked l LEFT JOIN current_paths c USING (full_path)
  WHERE c.full_path IS NULL
), classified AS (
  SELECT m.id,
    CASE
      WHEN coalesce(d.candidates, 0) = 1 THEN 'same_drive_name_candidate'
      WHEN coalesce(d.candidates, 0) > 1 THEN 'ambiguous_same_drive_name'
      WHEN coalesce(a.candidates, 0) > 0 THEN 'other_drive_name_candidate'
      ELSE 'no_name_candidate'
    END AS classification
  FROM missing m
  LEFT JOIN names_by_drive d USING (drive, filename)
  LEFT JOIN names_all a USING (filename)
)
SELECT classification, count(*)::integer AS link_count
FROM classified GROUP BY classification ORDER BY classification;
