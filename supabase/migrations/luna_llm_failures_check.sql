-- LLM 호출 실패 집계를 아침 약속 점검에 표시
begin;

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values (
  'llm_failures',
  'LLM 실패',
  '하루 5회 미만',
  0,
  0,
  '오늘 lunaLlmComplete 실패가 5회(🟡)·15회(🔴)를 넘으면 공급사·등급·기능을 확인하세요.',
  '/settings?menu=dashboard',
  '대시보드 →',
  126
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
