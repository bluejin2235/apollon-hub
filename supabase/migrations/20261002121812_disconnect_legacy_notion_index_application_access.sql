-- Preserve legacy Notion data while disconnecting application access.
REVOKE ALL PRIVILEGES ON TABLE
 public.luna_notion_pages,
 public.luna_notion_blocks,
 public.luna_notion_chunks,
 public.luna_notion_embeddings,
 public.luna_notion_chunk_embeddings,
 public.luna_notion_relations
FROM PUBLIC, anon, authenticated, service_role;

-- Revoke RPC entry points, including SECURITY DEFINER readers.
REVOKE EXECUTE ON FUNCTION
 public.luna_match_notion_blocks(vector,double precision,integer),
 public.luna_match_notion_chunks(vector,double precision,integer),
 public.luna_notion_keyword_candidates(text[],integer),
 public.luna_notion_readiness(),
 public.luna_primary_trend_days(timestamp with time zone)
FROM PUBLIC, anon, authenticated, service_role;
-- OAuth connection/attempt tables and NAS/image tables intentionally retain access.
NOTIFY pgrst, 'reload schema';