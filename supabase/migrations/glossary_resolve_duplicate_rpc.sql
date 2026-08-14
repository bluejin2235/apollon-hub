-- 용어 중복 해소: loser soft-delete + survivor 갱신 + 이력을 한 트랜잭션으로

create or replace function public.resolve_glossary_duplicate(
  p_survivor_id uuid,
  p_loser_ids uuid[],
  p_term_ko text,
  p_term_en text,
  p_term_zh text,
  p_definition text,
  p_categories text[],
  p_synonyms text[],
  p_user_id uuid,
  p_editor_name text,
  p_change_note text,
  p_loser_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loser uuid;
  v_next int;
  v_row public.glossary_terms%rowtype;
  v_conflict_id uuid;
  v_conflict_ko text;
  v_deleted uuid[] := array[]::uuid[];
  v_ids uuid[];
begin
  if p_survivor_id is null then
    raise exception 'SURVIVOR_REQUIRED';
  end if;
  if p_term_ko is null or btrim(p_term_ko) = '' then
    raise exception 'TERM_KO_REQUIRED';
  end if;

  -- loser 목록 + 같은 term_ko 를 가진 다른 활성 행도 포함
  select coalesce(array_agg(distinct x), array[]::uuid[])
  into v_ids
  from (
    select unnest(coalesce(p_loser_ids, array[]::uuid[])) as x
    union
    select id as x from public.glossary_terms
      where deleted_at is null
        and id <> p_survivor_id
        and term_ko = btrim(p_term_ko)
  ) s
  where x is not null and x <> p_survivor_id;

  foreach v_loser in array coalesce(v_ids, array[]::uuid[]) loop
    select * into v_row
    from public.glossary_terms
    where id = v_loser and deleted_at is null;
    if not found then
      continue;
    end if;

    v_next := coalesce(v_row.version, 1) + 1;
    insert into public.glossary_versions (
      term_id, version, term_ko, term_en, term_zh, definition, synonyms,
      editor_type, editor_id, editor_name, change_note
    ) values (
      v_row.id, v_next, v_row.term_ko, v_row.term_en, v_row.term_zh, v_row.definition,
      coalesce(v_row.synonyms, array[]::text[]),
      'human', p_user_id, p_editor_name, p_loser_note
    );

    update public.glossary_terms
    set
      deleted_at = now(),
      deleted_by = p_user_id,
      version = v_next,
      updated_by = p_user_id,
      updated_at = now()
    where id = v_loser;

    v_deleted := array_append(v_deleted, v_loser);
  end loop;

  select * into v_row
  from public.glossary_terms
  where id = p_survivor_id and deleted_at is null;
  if not found then
    raise exception 'SURVIVOR_NOT_FOUND';
  end if;

  v_next := coalesce(v_row.version, 1) + 1;

  begin
    update public.glossary_terms
    set
      term_ko = btrim(p_term_ko),
      term_en = nullif(btrim(coalesce(p_term_en, '')), ''),
      term_zh = nullif(btrim(coalesce(p_term_zh, '')), ''),
      definition = nullif(btrim(coalesce(p_definition, '')), ''),
      categories = coalesce(p_categories, array['공통']::text[]),
      synonyms = coalesce(p_synonyms, array[]::text[]),
      version = v_next,
      updated_by = p_user_id,
      updated_at = now()
    where id = p_survivor_id and deleted_at is null;
  exception
    when unique_violation then
      select id, term_ko into v_conflict_id, v_conflict_ko
      from public.glossary_terms
      where deleted_at is null
        and term_ko = btrim(p_term_ko)
        and id <> p_survivor_id
      limit 1;
      raise exception 'TERM_KO_CONFLICT:%:%',
        coalesce(v_conflict_ko, btrim(p_term_ko)),
        coalesce(v_conflict_id::text, '');
  end;

  insert into public.glossary_versions (
    term_id, version, term_ko, term_en, term_zh, definition, synonyms,
    editor_type, editor_id, editor_name, change_note
  ) values (
    p_survivor_id,
    v_next,
    btrim(p_term_ko),
    nullif(btrim(coalesce(p_term_en, '')), ''),
    nullif(btrim(coalesce(p_term_zh, '')), ''),
    nullif(btrim(coalesce(p_definition, '')), ''),
    coalesce(p_synonyms, array[]::text[]),
    'human',
    p_user_id,
    p_editor_name,
    p_change_note
  );

  return jsonb_build_object(
    'id', p_survivor_id,
    'version', v_next,
    'deleted_ids', to_jsonb(v_deleted)
  );
end;
$$;

revoke all on function public.resolve_glossary_duplicate(
  uuid, uuid[], text, text, text, text, text[], text[], uuid, text, text, text
) from public;

grant execute on function public.resolve_glossary_duplicate(
  uuid, uuid[], text, text, text, text, text[], text[], uuid, text, text, text
) to service_role;

grant execute on function public.resolve_glossary_duplicate(
  uuid, uuid[], text, text, text, text, text[], text[], uuid, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
