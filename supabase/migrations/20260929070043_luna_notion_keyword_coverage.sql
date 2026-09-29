-- Rank the complete matching population before applying a result limit.
-- Repeated headings/chunks do not multiply a page's score.
create or replace function public.luna_notion_keyword_candidates(
  query_terms text[], result_limit integer default 60
) returns table(chunk_id text, page_id text, keyword_score double precision)
language sql stable security invoker set search_path = public
as $$
with terms as materialized (
  select distinct lower(regexp_replace(t, '\s+', '', 'g')) term
  from unnest(query_terms) t where length(trim(t)) > 0
  limit 10
), concepts as (
  select term,case term
    when '숲' then array['숲','forest','포레스트']
    when '야외' then array['야외','옥외','실외','outdoor']
    when '미디어아트' then array['미디어아트','mediaart']
    else array[term] end aliases from terms
), docs as materialized (
  select p.page_id,
    lower(regexp_replace(p.title, '\s+', '', 'g')) title,
    lower(regexp_replace(p.title || ' ' || string_agg(coalesce(c.heading,'') || ' ' || c.text, ' '), '\s+', '', 'g')) body
  from public.luna_notion_pages p join public.luna_notion_chunks c using(page_id)
  where not p.archived
  group by p.page_id,p.title
), matches as materialized (
  select d.page_id,t.term, case when strpos(d.title,t.term)>0 then 1.25 else 1.0 end weight
  from docs d cross join concepts t where exists(select 1 from unnest(t.aliases) a where strpos(d.body,a)>0)
), frequency as (
  select term,count(*) n from matches group by term
), ranks as (
  select m.page_id,
    sum(m.weight * ln(1.0 + (select count(*) from docs)::numeric/f.n))::double precision
      * (1.0 + count(*)::double precision) score
  from matches m join frequency f using(term) group by m.page_id
), diverse as (
  select r.*,row_number() over(partition by md5(d.body) order by r.score desc,r.page_id) duplicate_rank
  from ranks r join docs d using(page_id)
), shortlist as materialized (
  select * from diverse where duplicate_rank=1 order by score desc,page_id limit greatest(1,least(result_limit,120))
), snippets as (
  select c.chunk_id,c.page_id,s.score,
    (select count(*) from concepts t where exists(select 1 from unnest(t.aliases) a where strpos(lower(regexp_replace(coalesce(c.heading,'') || ' ' || c.text,'\s+','','g')),a)>0)) hits
  from public.luna_notion_chunks c join shortlist s using(page_id)
), ranked_snippets as (
  select *,row_number() over(partition by page_id order by hits desc,chunk_id) rn from snippets
)
select chunk_id,page_id,score + hits::double precision/100
from ranked_snippets where rn<=3 and hits>0
order by score desc,rn,chunk_id limit greatest(1,least(result_limit,120));
$$;
revoke all on function public.luna_notion_keyword_candidates(text[],integer) from public,anon,authenticated;
grant execute on function public.luna_notion_keyword_candidates(text[],integer) to service_role;
