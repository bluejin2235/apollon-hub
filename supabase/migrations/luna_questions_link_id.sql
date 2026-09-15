-- luna_questions.learning_id → luna_learnings (지식 학습)
-- luna_questions.link_id → luna_links (2차 데이터 「같은 것」판정)
begin;

alter table public.luna_questions
  add column if not exists link_id uuid references public.luna_links (id) on delete set null;

create index if not exists luna_questions_link_idx
  on public.luna_questions (link_id);

commit;
