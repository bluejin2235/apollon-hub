-- Apply before deploying the corresponding application changes.
-- Production data is preserved; synthetic records are retained but excluded from learning.
begin;

alter table public.luna_conversations
  add column if not exists data_context text not null default 'production'
    check (data_context in ('production', 'synthetic'));
alter table public.luna_learnings
  add column if not exists data_context text not null default 'production'
    check (data_context in ('production', 'synthetic'));

create or replace function public.luna_conversation_data_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title like '[P9TEST:%' or new.title like '[role-latency-%'
     or new.title like '[LUNA-EVAL:%' then
    new.data_context := 'synthetic';
  end if;
  -- Renaming a test must not silently turn it into production training data.
  if tg_op = 'UPDATE' then
    if old.data_context = 'synthetic' then new.data_context := 'synthetic'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.luna_conversation_data_context() from public, anon, authenticated;
drop trigger if exists luna_conversation_data_context on public.luna_conversations;
create trigger luna_conversation_data_context before insert or update
on public.luna_conversations for each row execute function public.luna_conversation_data_context();

create or replace function public.luna_learning_data_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.meta->>'data_context' = 'synthetic' or new.meta->>'is_test' = 'true'
     or coalesce(btrim(new.meta->>'test_run_id'), '') <> ''
     or exists (select 1 from public.luna_conversations c
                where c.id = new.source_conversation_id and c.data_context = 'synthetic') then
    new.data_context := 'synthetic';
  end if;
  if tg_op = 'UPDATE' then
    if old.data_context = 'synthetic' then new.data_context := 'synthetic'; end if;
  end if;
  if new.data_context = 'synthetic' then
    new.status := 'archived';
    new.meta := coalesce(new.meta, '{}'::jsonb) || '{"data_context":"synthetic"}'::jsonb;
  end if;
  return new;
end;
$$;
revoke all on function public.luna_learning_data_context() from public, anon, authenticated;
drop trigger if exists luna_learning_data_context on public.luna_learnings;
create trigger luna_learning_data_context before insert or update
on public.luna_learnings for each row execute function public.luna_learning_data_context();

update public.luna_conversations set data_context = 'synthetic'
where title like '[P9TEST:%' or title like '[role-latency-%' or title like '[LUNA-EVAL:%';
update public.luna_learnings set data_context = 'synthetic'
where meta->>'data_context' = 'synthetic' or meta->>'is_test' = 'true'
   or coalesce(btrim(meta->>'test_run_id'), '') <> ''
   or source_conversation_id in (
     select id from public.luna_conversations where data_context = 'synthetic'
   )
   -- Audited fixture. Both ID and content must match; no broad keyword purge.
   or (id = '89100bd6-dd28-4a42-8e02-6284bc9ebc36'::uuid
       and content like '%검증용 고유 지식문장%' and content ilike '%melona%');

create or replace function public.luna_inbox_decide(
  p_type text, p_id uuid, p_decision text, p_note text default null,
  p_actor uuid default null, p_via text default 'claude_voice'
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := coalesce(auth.uid(), p_actor);
begin
  if actor is null or not exists (
    select 1 from public.profiles where id = actor and btrim(role::text) = '슈퍼관리자'
  ) then
    raise exception 'Administrator actor required' using errcode = '42501';
  end if;
  if auth.uid() is not null and p_actor is not null and auth.uid() <> p_actor then
    raise exception 'Actor does not match authenticated user' using errcode = '42501';
  end if;

  if p_type = 'question' then
    update public.luna_questions
      set status='answered', answer=p_note, answered_by=actor, answered_at=now()
      where id=p_id and status='pending';
  elsif p_type = 'learning_conflict' then
    update public.luna_learnings
      set status = case when p_decision='approve' then 'active' else 'archived' end,
          resolved_by=actor, resolved_at=now()
      where id=p_id and status='conflict' and data_context='production';
  elsif p_type = 'rule_candidate' then
    update public.luna_rules
      set status = case when p_decision='approve' then 'active' else 'dropped' end,
          confirmed_at=now(), confirmed_by=actor
      where id=p_id and status='candidate';
  else
    return 'unknown item_type: ' || p_type;
  end if;
  if not found then return 'no pending item matched'; end if;
  insert into public.luna_decisions(item_type, item_id, decision, note, decided_by, decided_via)
  values (p_type, p_id, p_decision, p_note, actor, p_via);
  return 'ok';
end;
$$;
revoke all on function public.luna_inbox_decide(text,uuid,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.luna_inbox_decide(text,uuid,text,text,uuid,text) to service_role;

-- The inbox is an administrative aggregate, not a public Data API view.
alter view public.luna_inbox set (security_invoker = true);
revoke all on public.luna_inbox from public, anon, authenticated;
grant select on public.luna_inbox to service_role;

commit;
