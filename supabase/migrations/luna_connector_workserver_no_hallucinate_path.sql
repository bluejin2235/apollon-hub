-- connector.workserver: 확인되지 않은 경로 금지 (version 2 → 3)
-- 블루진 실행용. 앱에서 실행하지 않음.

do $$
declare
  v_id uuid := 'fbf1958e-083c-430d-8f21-c10022c8394c';
  v_old text;
  v_new text;
  v_next int;
  v_title text;
  v_description text;
  v_purpose text;
  v_owner_id uuid;
  v_sort_order int;
begin
  select content, version, title, description, purpose, owner_id, sort_order
    into v_old, v_next, v_title, v_description, v_purpose, v_owner_id, v_sort_order
  from public.luna_prompts
  where id = v_id
  for update;

  if v_old is null then
    raise exception 'connector.workserver prompt not found';
  end if;

  if position('검색으로 확인되지 않은 경로는 절대 답하지 않는다' in v_old) > 0 then
    raise notice 'already applied, skip';
    return;
  end if;

  v_new := rtrim(v_old) || E'\n\n검색으로 확인되지 않은 경로는 절대 답하지 않는다. 없으면 없다고 말하는 것이 잘못 안내하는 것보다 낫다.';
  v_next := coalesce(v_next, 1) + 1;

  update public.luna_prompts
  set
    content = v_new,
    version = v_next,
    updated_at = now()
  where id = v_id;

  insert into public.luna_prompt_versions (
    target_type,
    target_id,
    version,
    content,
    change_summary,
    prediction,
    changed_by,
    changed_by_luna
  ) values (
    'prompt',
    v_id,
    v_next,
    jsonb_build_object(
      'title', v_title,
      'description', v_description,
      'purpose', v_purpose,
      'content', v_new,
      'owner_id', v_owner_id,
      'sort_order', v_sort_order
    ),
    '환각 근절 — 확인되지 않은 Work서버 경로 금지, 없으면 없다고 말하라',
    '검색 0건일 때 가짜 T:\\ 경로를 지어내지 않고 찾지 못했다고 답한다',
    null,
    true
  );
end $$;
