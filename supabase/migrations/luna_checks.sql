-- 약속 점검 — 정기 작업이 기한 안에 돌았는지
begin;

create table if not exists public.luna_checks (
  id text primary key,
  label text not null,
  promise_label text not null,
  yellow_days integer not null default 2,
  red_days integer not null default 7,
  meaning_when_stale text not null default '',
  href text not null default '/settings',
  btn_label text not null default '보기',
  sort_order integer not null default 0,
  enabled boolean not null default true,
  last_ok_at timestamptz,
  last_checked_at timestamptz,
  status text not null default 'unknown'
    check (status in ('ok', 'warn', 'bad', 'unknown')),
  days_stale integer,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.luna_checks enable row level security;

revoke all on public.luna_checks from anon, authenticated;
grant all on public.luna_checks to service_role;

insert into public.luna_checks (
  id, label, promise_label, yellow_days, red_days,
  meaning_when_stale, href, btn_label, sort_order
) values
  (
    'model_market',
    '모델 시세 수집',
    '주 1회 약속',
    7,
    14,
    '한 달 전 가격으로 등급을 판단하고 있습니다. 교체가 일어날 수 없습니다.',
    '/settings?menu=brain&sub=model',
    '두뇌 →',
    10
  ),
  (
    'work_index',
    'Work서버 색인',
    '매일 03:00 약속',
    2,
    3,
    'Work서버 파일 목록이 오래됐습니다. 검색·연결이 낡은 목록을 봅니다.',
    '/settings?menu=knowledge&sub=primary',
    '지식 →',
    20
  ),
  (
    'notion_index',
    '노션 색인',
    '매일 03:20·13:30 약속',
    1,
    2,
    '노션 본문 검색이 최신이 아닙니다. 최근 페이지를 못 찾을 수 있습니다.',
    '/settings?menu=knowledge&sub=primary',
    '지식 →',
    30
  ),
  (
    'image_index',
    '이미지 색인',
    '매일 04:00 약속',
    2,
    7,
    '작업 스케줄러가 안 돌면 이미지 검색이 늘지 않습니다. 제가 PC 스케줄러를 켤 수 없습니다.',
    '/settings?menu=knowledge&sub=primary',
    '지식 →',
    40
  ),
  (
    'links',
    '2차 데이터',
    '매일 04:30 약속',
    2,
    3,
    '연결이 안 늘면 검색이 조각을 이어 주지 못합니다.',
    '/settings?menu=knowledge&sub=secondary',
    '2차 →',
    50
  ),
  (
    'selfstudy',
    '자습',
    '매일 05:00 약속',
    2,
    3,
    '자습이 멈추면 실패 수집·색인을 스스로 시험하지 못합니다.',
    '/settings?menu=selfstudy&sub=history',
    '자습 →',
    60
  ),
  (
    'signals',
    '신호 분석',
    '매일 05:30 약속',
    2,
    3,
    '신호가 안 모이면 규칙 후보·실패 패턴을 놓칩니다.',
    '/settings?menu=failures&sub=analysis',
    '실패 →',
    70
  ),
  (
    'admin_report',
    '아침 메일',
    '매일 07:00 약속',
    2,
    3,
    '아침 메일이 안 가면 멈춘 것을 하루 더 모릅니다.',
    '/settings?menu=dashboard',
    '대시보드 →',
    80
  ),
  (
    'eval_light',
    '매일 점검',
    '매일 03:40 약속',
    '/settings?menu=brain&sub=eval',
    '두뇌 →',
    90
  ),
  (
    'consolidate',
    '후보 정리',
    '매일 03:30 약속',
    2,
    3,
    '정리가 멈추면 지식후보가 쌓이기만 합니다.',
    '/settings?menu=candidates&sub=pending',
    '지식후보 →',
    100
  ),
  (
    'fx_rates',
    '환율',
    '매일 09:15 약속',
    2,
    3,
    '환율이 오래되면 모델 비용 비교가 어긋납니다.',
    '/settings?menu=brain&sub=model',
    '두뇌 →',
    110
  ),
  (
    'disk',
    '디스크',
    '상시',
    999,
    999,
    '디스크 점검은 별도 신호가 없습니다. 정상이면 접어둡니다.',
    '/settings?menu=dashboard',
    '대시보드 →',
    120
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
