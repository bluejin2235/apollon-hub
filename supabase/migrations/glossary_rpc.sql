-- 용어 저장: term_id null이면 신규(v1), 있으면 버전++ 후 이력 스냅샷 기록
create or replace function public.save_term(
  p_term_id uuid, p_ko text, p_en text, p_zh text, p_zh_pron text,
  p_category glossary_category, p_definition text, p_change_note text default null
) returns public.glossary_terms
language plpgsql security definer set search_path = public as $$
declare v_term public.glossary_terms; v_name text;
begin
  select coalesce(raw_user_meta_data->>'name', email) into v_name from auth.users where id = auth.uid();
  if p_term_id is null then
    insert into glossary_terms(term_ko,term_en,term_zh,term_zh_pron,category,definition,version,created_by,updated_by)
    values(p_ko,p_en,p_zh,p_zh_pron,p_category,p_definition,1,auth.uid(),auth.uid())
    returning * into v_term;
  else
    update glossary_terms set term_ko=p_ko,term_en=p_en,term_zh=p_zh,term_zh_pron=p_zh_pron,
      category=p_category,definition=p_definition,version=version+1,updated_by=auth.uid(),updated_at=now()
    where id=p_term_id returning * into v_term;
  end if;
  insert into glossary_versions(term_id,version,term_ko,term_en,term_zh,term_zh_pron,definition,editor_type,edited_by,editor_name,change_note)
  values(v_term.id,v_term.version,v_term.term_ko,v_term.term_en,v_term.term_zh,v_term.term_zh_pron,v_term.definition,'human',auth.uid(),v_name,p_change_note);
  return v_term;
end $$;

-- 지식 후보 승인 → 정식 용어 등록(+이력 luna 표기) → 후보 approved 처리
create or replace function public.approve_candidate(
  p_candidate_id uuid, p_ko text default null, p_en text default null, p_zh text default null,
  p_zh_pron text default null, p_category glossary_category default null, p_definition text default null
) returns public.glossary_terms
language plpgsql security definer set search_path = public as $$
declare c public.glossary_candidates; v_term public.glossary_terms; v_name text;
begin
  select * into c from glossary_candidates where id=p_candidate_id and status='pending';
  if not found then raise exception '후보를 찾을 수 없거나 이미 처리됨'; end if;
  select coalesce(raw_user_meta_data->>'name', email) into v_name from auth.users where id=auth.uid();
  insert into glossary_terms(term_ko,term_en,term_zh,term_zh_pron,category,definition,version,created_by,updated_by)
  values(coalesce(p_ko,c.term_ko),coalesce(p_en,c.term_en),coalesce(p_zh,c.term_zh),
         coalesce(p_zh_pron,c.term_zh_pron),coalesce(p_category,c.category),
         coalesce(p_definition,c.definition_draft),1,auth.uid(),auth.uid())
  returning * into v_term;
  insert into glossary_versions(term_id,version,term_ko,term_en,term_zh,term_zh_pron,definition,editor_type,edited_by,editor_name,change_note)
  values(v_term.id,1,v_term.term_ko,v_term.term_en,v_term.term_zh,v_term.term_zh_pron,v_term.definition,'luna',auth.uid(),v_name,'루나 지식 후보 승인');
  update glossary_candidates set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=p_candidate_id;
  return v_term;
end $$;

create or replace function public.reject_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update glossary_candidates set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
  where id=p_candidate_id and status='pending';
end $$;

grant execute on function public.save_term         to authenticated;
grant execute on function public.approve_candidate to authenticated;
grant execute on function public.reject_candidate  to authenticated;

notify pgrst, 'reload schema';
