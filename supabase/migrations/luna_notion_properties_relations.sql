-- 노션 색인 — 페이지 속성 + 관계 (실행하지 마라. 블루진이 적용)
-- 기존 블록·청크·임베딩은 건드리지 않는다.

alter table public.luna_notion_pages
  add column if not exists properties jsonb;

comment on column public.luna_notion_pages.properties is
  'Notion page properties 원본. 임베딩하지 않는다.';

create table if not exists public.luna_notion_relations (
  from_page_id text not null,
  to_page_id text not null,
  property_name text not null,
  primary key (from_page_id, to_page_id, property_name)
);

create index if not exists luna_notion_relations_to_page_id_idx
  on public.luna_notion_relations (to_page_id);

comment on table public.luna_notion_relations is
  '노션 관계 속성. 검색 순위가 아니라 찾은 뒤 따라가는 연결. 임베딩하지 않는다.';

grant select on public.luna_notion_relations to authenticated;
grant all on public.luna_notion_relations to service_role;
