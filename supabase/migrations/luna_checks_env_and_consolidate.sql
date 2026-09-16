-- 후보 정리 체크 기한을 백스톱(14일)에 맞추고, 환경변수 이름 점검 행을 추가한다.
begin;

update public.luna_checks
set
  yellow_days = 14,
  red_days = 16,
  promise_label = '매일 03:30 확인 · 14일 또는 30건',
  meaning_when_stale = '14일이 지나도 정리가 안 돌면 지식후보가 쌓이기만 합니다.',
  updated_at = now()
where id = 'consolidate';

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values (
  'env_keys',
  '환경변수',
  '배포 환경변수',
  1,
  1,
  '이름이 어긋나면 작업이 조용히 옛 데이터로 넘어갑니다.',
  '/settings?menu=dashboard',
  '대시보드 →',
  5
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
