begin;
-- One file publication is one transaction. Existing runners must be stopped
-- before deployment; their direct table writes do not follow this CAS contract.
create or replace function public.nas_text_publish(
  p_meta jsonb, p_chunks text[], p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  m public.nas_file_text;
  old public.nas_file_text;
  had_old boolean;
  keep_chunks boolean := false;
  current_contents text[];
  first_seq integer;
  last_seq integer;
  n integer;
  latest_batch timestamptz;
  stamp timestamptz;
begin
  if jsonb_typeof(p_meta) is distinct from 'object' or p_chunks is null then
    raise exception 'Invalid publication payload';
  end if;
  select * into m from jsonb_populate_record(null::public.nas_file_text, p_meta);
  n := cardinality(p_chunks);
  if coalesce(m.path,'')='' or m.drive is null or m.drive not in ('T','P') or
     coalesce(m.ext,'')='' or m.status is null or m.status not in ('ok','empty','failed','skipped') or
     m.size_bytes is null or m.size_bytes<0 or m.modified_at is null or
     m.text_length is null or m.text_length<0 or m.chunk_count is distinct from n or
     m.extracted_at is null or n>200 then
    raise exception 'Invalid publication metadata';
  end if;
  if (m.status='ok' and (n=0 or coalesce(m.content_hash,'')='' or m.text_length=0)) or
     (m.status<>'ok' and (n<>0 or m.content_hash is not null or m.text_length<>0)) or
     exists(select 1 from unnest(p_chunks) c where c is null or btrim(c)='' or octet_length(c)>16384) then
    raise exception 'Invalid publication chunks';
  end if;

  perform pg_advisory_xact_lock(78292, hashtext(m.path));
  -- Snapshot commits and legacy directory writes cannot change the indexed
  -- source while this short publication validates and commits its result.
  lock table public.nas_directory in share mode;
  select max(scan_batch) into latest_batch from public.nas_directory where drive=m.drive;
  if not exists(select 1 from public.nas_directory d where d.drive=m.drive and d.path=m.path
      and d.scan_batch=latest_batch and d.type='file'
      and d.size_bytes=m.size_bytes and d.modified_at=m.modified_at) or
     exists(select 1 from public.nas_directory d where d.path=m.path and d.drive<>m.drive
      and d.scan_batch=(select max(d2.scan_batch) from public.nas_directory d2 where d2.drive=d.drive)) then
    raise exception 'Source changed, missing or ambiguous' using errcode='40001';
  end if;
  select * into old from public.nas_file_text where path=m.path for update;
  had_old := found;
  if (had_old and old.updated_at is distinct from p_expected_updated_at) or
     (not had_old and p_expected_updated_at is not null) then
    raise exception 'Publication version changed' using errcode='40001';
  end if;
  if had_old and old.status='ok' and m.status='ok' and old.content_hash=m.content_hash then
    select array_agg(content order by seq),min(seq),max(seq)
      into current_contents,first_seq,last_seq from public.nas_file_chunks where path=m.path;
    keep_chunks := current_contents is not distinct from p_chunks and first_seq=0 and last_seq=n-1;
  end if;
  stamp := greatest(clock_timestamp(),coalesce(old.updated_at, '-infinity'::timestamptz)+interval '1 microsecond');
  insert into public.nas_file_text(path,drive,ext,size_bytes,modified_at,content_hash,text_length,
    chunk_count,status,skip_reason,error,extracted_at,updated_at)
  values(m.path,m.drive,m.ext,m.size_bytes,m.modified_at,m.content_hash,m.text_length,n,
    m.status,m.skip_reason,m.error,m.extracted_at,stamp)
  on conflict(path) do update set drive=excluded.drive,ext=excluded.ext,size_bytes=excluded.size_bytes,
    modified_at=excluded.modified_at,content_hash=excluded.content_hash,text_length=excluded.text_length,
    chunk_count=excluded.chunk_count,status=excluded.status,skip_reason=excluded.skip_reason,
    error=excluded.error,extracted_at=excluded.extracted_at,updated_at=excluded.updated_at;
  if not keep_chunks then
    delete from public.nas_file_chunks where path=m.path;
    insert into public.nas_file_chunks(path,seq,content)
      select m.path,(ordinality-1)::integer,content from unnest(p_chunks) with ordinality as c(content,ordinality);
  end if;
  return jsonb_build_object('updated_at',stamp,'chunks_created',case when keep_chunks then 0 else n end,
    'chunks_preserved',keep_chunks);
end;
$$;
revoke all on function public.nas_text_publish(jsonb,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.nas_text_publish(jsonb,text[],timestamptz) to service_role;
commit;
