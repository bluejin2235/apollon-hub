begin;
-- A bounded, keyset-paginated queue. No source is selected merely because its
-- old chunk still has a null vector. UUID order is traversal order, not relevance.
create or replace function public.nas_embedding_candidates(
  p_limit integer default 500, p_after_id uuid default null, p_ids uuid[] default null
) returns table(id uuid,path text,seq integer,content text,source_version timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>500 or cardinality(p_ids)>100 then
    raise exception 'Invalid embedding queue bounds';
  end if;
  return query
    select c.id,c.path,c.seq,c.content,t.updated_at
    from public.nas_file_chunks c join public.nas_file_text t on t.path=c.path
    where c.embedding is null and t.status='ok' and t.chunk_count>0
      and coalesce(t.content_hash,'')<>'' and t.updated_at is not null
      and (p_after_id is null or c.id>p_after_id) and (p_ids is null or c.id=any(p_ids))
      and btrim(regexp_replace(c.content,
        '^[[:space:]]*--[[:space:]]*[0-9]+[[:space:]]+of[[:space:]]+[0-9]+[[:space:]]*--[[:space:]]*$', '', 'gn'), E' \t\r\n')<>''
      and exists(select 1 from public.nas_directory d where d.drive=t.drive and d.path=t.path and d.type='file'
        and d.size_bytes=t.size_bytes and d.modified_at=t.modified_at
        and d.scan_batch=(select max(d2.scan_batch) from public.nas_directory d2 where d2.drive=t.drive))
      and not exists(select 1 from public.nas_directory d where d.path=t.path and d.drive<>t.drive
        and d.scan_batch=(select max(d2.scan_batch) from public.nas_directory d2 where d2.drive=d.drive))
      and (select count(*)=t.chunk_count and min(k.seq)=0 and max(k.seq)=t.chunk_count-1
        from public.nas_file_chunks k where k.path=t.path)
    order by c.id limit p_limit;
end;
$$;

-- Vectors and the completion marker are stored together only for the same
-- still-current source revision. Uses the same lock order as nas_text_publish.
create or replace function public.nas_embedding_store_batch(p_rows jsonb)
returns uuid[] language plpgsql security invoker set search_path='' as $$
declare
  item record;
  target_path text;
  accepted uuid[] := array[]::uuid[];
  accepted_id uuid;
  ids uuid[];
  embedded public.vector;
  vector_json jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>100 then
    raise exception 'Embedding batch must have 1 to 100 rows';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) is distinct from 'object'
    or coalesce(r->>'id','')='' or coalesce(r->>'path','')='' or r->>'seq' is null
    or r->>'content' is null or r->>'source_version' is null or r->>'embedding' is null) then
    raise exception 'Invalid embedding row';
  end if;
  select array_agg((r->>'id')::uuid) into ids from jsonb_array_elements(p_rows) r;
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then
    raise exception 'Duplicate embedding IDs';
  end if;
  for target_path in select distinct c.path from public.nas_file_chunks c where c.id=any(ids) order by c.path loop
    perform pg_advisory_xact_lock(78292,hashtext(target_path));
  end loop;
  lock table public.nas_directory in share mode;
  perform 1 from public.nas_file_text t where t.path in
    (select c.path from public.nas_file_chunks c where c.id=any(ids)) order by t.path for update;

  for item in select r.*,q.path as current_path from jsonb_to_recordset(p_rows) as r(
      id uuid,path text,seq integer,content text,source_version timestamptz,embedding text)
    join public.nas_embedding_candidates(100,null,ids) q on q.id=r.id and q.path=r.path
      and q.seq=r.seq and q.content=r.content and q.source_version=r.source_version
  loop
    vector_json := item.embedding::jsonb;
    if jsonb_typeof(vector_json) is distinct from 'array' then raise exception 'Invalid vector array'; end if;
    if jsonb_array_length(vector_json)<>1536 then raise exception 'Invalid embedding dimensions'; end if;
    if exists(select 1 from jsonb_array_elements(vector_json) e where
      case when jsonb_typeof(e)='number' then abs((e#>>'{}')::numeric)>3.4028234663852886e38 else true end) then
      raise exception 'Invalid embedding component';
    end if;
    embedded := item.embedding::public.vector;
    if public.vector_norm(embedded)=0 then raise exception 'Zero embedding vector'; end if;
    update public.nas_file_chunks c set embedding=embedded
      where c.id=item.id and c.path=item.path and c.seq=item.seq and c.content=item.content and c.embedding is null
      returning c.id into accepted_id;
    if found then accepted := array_append(accepted,accepted_id); end if;
  end loop;
  -- Do not change updated_at: this is a derivative completion marker, not a
  -- new extracted source revision, and other batches retain their source token.
  update public.nas_file_text t set indexed_at=clock_timestamp()
    where t.status='ok' and t.path in (select c.path from public.nas_file_chunks c where c.id=any(accepted))
      and (select count(*)=t.chunk_count and min(c.seq)=0 and max(c.seq)=t.chunk_count-1
        and bool_and(c.embedding is not null) from public.nas_file_chunks c where c.path=t.path);
  return accepted;
end;
$$;
revoke all on function public.nas_embedding_candidates(integer,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.nas_embedding_store_batch(jsonb) from public,anon,authenticated;
grant execute on function public.nas_embedding_candidates(integer,uuid,uuid[]) to service_role;
grant execute on function public.nas_embedding_store_batch(jsonb) to service_role;
commit;
