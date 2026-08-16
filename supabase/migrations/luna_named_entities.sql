-- 발주처·프로젝트 고유명사 / 별칭 (F2·F3)
-- 적용: Supabase SQL Editor (블루진)
-- 코드는 테이블이 없어도 NAMED_ENTITY_SEED 로 동작한다.

create table if not exists public.luna_named_entities (
  id uuid primary key default gen_random_uuid(),
  canonical text not null unique,
  kind text not null check (kind in ('brand_group', 'client', 'project')),
  parent_canonical text,
  aliases text[] not null default '{}',
  search_phrases text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_luna_named_entities_kind
  on public.luna_named_entities (kind);

comment on table public.luna_named_entities is
  '루나 검색·되묻기용 고유명사. 상위 브랜드(롯데)와 하위(롯데면세점)를 분리한다.';

alter table public.luna_named_entities enable row level security;

drop policy if exists "luna_named_entities_select_auth" on public.luna_named_entities;
create policy "luna_named_entities_select_auth"
  on public.luna_named_entities for select to authenticated using (true);

grant select on public.luna_named_entities to authenticated;
grant all on public.luna_named_entities to service_role;

insert into public.luna_named_entities
  (canonical, kind, parent_canonical, aliases, search_phrases, notes)
values
  ('롯데', 'brand_group', null, array['롯데그룹','lotte'], '{}', '상위 브랜드. 이 토큰만으로 하위 계열사를 매칭하지 않음'),
  ('롯데면세점', 'client', '롯데', array['롯데 면세점','LDF','롯데면세'], array['롯데면세점','롯데 면세점'], null),
  ('롯데월드', 'client', '롯데', array['롯데월드몰','롯데 월드'], array['롯데월드','롯데월드몰'], null),
  ('롯데물산', 'client', '롯데', array['롯데 물산'], array['롯데물산'], null),
  ('롯데타워', 'project', '롯데', array['롯데 타워','롯데월드타워'], array['롯데타워','롯데월드타워'], null),
  ('스타에비뉴', 'project', '롯데면세점',
    array['스타 에비뉴','STAR AVENUE','LDF STAR AVENUE','롯데면세점 스타에비뉴','롯데 면세점 스타에비뉴','롯데면세점 명동 리뉴얼'],
    array['스타에비뉴','star avenue','스타 에비뉴'],
    'K1 인터뷰에서 별칭 보강'),
  ('인스파이어', 'project', null, array['INSPIRE','인스파이어리조트'], array['인스파이어'], null),
  ('해운대', 'project', null, array['해운대스퀘어','해운대 스퀘어'], array['해운대'], null),
  ('더후', 'project', null, array['THE WHOO'], array['더후','the whoo'], null)
on conflict (canonical) do update set
  kind = excluded.kind,
  parent_canonical = excluded.parent_canonical,
  aliases = excluded.aliases,
  search_phrases = excluded.search_phrases,
  notes = excluded.notes;

-- talk.understand: 프로젝트명 없는 개념 질문에 프로젝트 선택지 금지
update public.luna_prompts
set
  content = content || E'\n\n프로젝트명이 문장에 없으면 인스파이어·해운대·더후 같은 프로젝트 선택지를 만들지 마라.\n누가/언제/어떻게 형태의 개념·프로세스 질문(주관, 참여, 역할, 절차)은 파일 검색이 아니라 일반 지식으로 먼저 답한다. needs_clarify=false.',
  version = version + 1,
  updated_at = now()
where prompt_key = 'talk.understand'
  and is_active = true
  and content not like '%프로젝트명이 문장에 없으면%';
