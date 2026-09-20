-- 약속 점검 4건 — 원천 통계·memo·찾았어요·질문 있어요
begin;

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values
  (
    'source_stats',
    '원천 통계',
    '매일 03:30 약속',
    1,
    2,
    '원천 통계가 멈추면 1차 데이터·아침 리포트가 이틀 전 값을 씁니다.',
    '/settings?menu=knowledge&sub=primary',
    '1차 →',
    102
  ),
  (
    'user_memories',
    'memo 갱신',
    '매시 정각 약속',
    1,
    2,
    'memo 갱신이 멈추면 개인 기억이 대화에 반영되지 않습니다.',
    '/settings?menu=conversation&sub=personalization',
    '개인화 →',
    104
  ),
  (
    'answer_found',
    '찾았어요',
    '사람이 누를 때 · 이번 주 건수',
    0,
    0,
    '이번 주 0건이어도 정상일 수 있습니다. 사람이 눌러야 쌓입니다.',
    '/settings?menu=conversation&sub=personalization',
    '개인화 →',
    106
  ),
  (
    'open_questions',
    '질문 있어요',
    '쌓일 때만 · 이번 주 건수',
    0,
    0,
    '이번 주 0건이어도 정상일 수 있습니다. 질문이 생길 때만 쌓입니다.',
    '/settings?menu=conversation&sub=personalization',
    '개인화 →',
    108
  )
on conflict (id) do update set
  label = excluded.label,
  promise_label = excluded.promise_label,
  yellow_days = excluded.yellow_days,
  red_days = excluded.red_days,
  meaning_when_stale = excluded.meaning_when_stale,
  href = excluded.href,
  btn_label = excluded.btn_label,
  sort_order = excluded.sort_order,
  updated_at = now();

commit;
