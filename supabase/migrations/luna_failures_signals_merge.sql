-- 실패 수집: message_id 당 1건 + signals[]
-- 제시만. 실행은 블루진이 한다. (이 파일을 적용하기 전에 백업 권장)

begin;

-- 1) signals 컬럼
alter table public.luna_failures
  add column if not exists signals text[] not null default '{}';

-- 2) 기존 행: signals 비어 있으면 signal 로 채움
update public.luna_failures
set signals = array[signal]::text[]
where coalesce(cardinality(signals), 0) = 0;

-- 3) 같은 message_id 중복 병합 (우선순위 높은 signal 을 대표로, signals 합집합)
--    우선순위: thumbs_down > correction > not_found > low_confidence > low_intent > zero_search > unclassified > candidate_deleted > eval_fail
with ranked as (
  select
    id,
    message_id,
    signal,
    self_note,
    intent_score,
    confidence_score,
    kind,
    source_ref,
    created_at,
    case signal
      when 'thumbs_down' then 1
      when 'correction' then 2
      when 'not_found' then 3
      when 'low_confidence' then 4
      when 'low_intent' then 5
      when 'zero_search' then 6
      when 'unclassified' then 7
      when 'candidate_deleted' then 8
      when 'eval_fail' then 9
      else 99
    end as prio,
    row_number() over (
      partition by message_id
      order by
        case signal
          when 'thumbs_down' then 1
          when 'correction' then 2
          when 'not_found' then 3
          when 'low_confidence' then 4
          when 'low_intent' then 5
          when 'zero_search' then 6
          when 'unclassified' then 7
          when 'candidate_deleted' then 8
          when 'eval_fail' then 9
          else 99
        end,
        created_at asc
    ) as rn
  from public.luna_failures
  where message_id is not null
),
agg as (
  select
    message_id,
    (array_agg(id order by prio, created_at))[1] as keep_id,
    array_agg(distinct signal) as all_signals,
    (array_agg(self_note order by (self_note is null), created_at))[1] as keep_note,
    (array_agg(intent_score order by (intent_score is null), created_at))[1] as keep_intent,
    (array_agg(confidence_score order by (confidence_score is null), created_at))[1] as keep_conf
  from ranked
  group by message_id
  having count(*) > 1
)
update public.luna_failures f
set
  signals = a.all_signals,
  signal = (
    select s from unnest(a.all_signals) as s
    order by case s
      when 'thumbs_down' then 1
      when 'correction' then 2
      when 'not_found' then 3
      when 'low_confidence' then 4
      when 'low_intent' then 5
      when 'zero_search' then 6
      when 'unclassified' then 7
      when 'candidate_deleted' then 8
      when 'eval_fail' then 9
      else 99
    end
    limit 1
  ),
  self_note = coalesce(f.self_note, a.keep_note),
  intent_score = coalesce(f.intent_score, a.keep_intent),
  confidence_score = coalesce(f.confidence_score, a.keep_conf),
  kind = case
    when 'thumbs_down' = any (a.all_signals) or 'correction' = any (a.all_signals) then 'human'
    when 'low_confidence' = any (a.all_signals) or 'low_intent' = any (a.all_signals) then 'self'
    else f.kind
  end
from agg a
where f.id = a.keep_id;

-- 4) 중복 행 제거 (keep_id 만 남김) — 실패 「기록」은 keep 행에 병합됨
delete from public.luna_failures f
using (
  select message_id, (array_agg(id order by
    case signal
      when 'thumbs_down' then 1
      when 'correction' then 2
      when 'not_found' then 3
      when 'low_confidence' then 4
      when 'low_intent' then 5
      when 'zero_search' then 6
      when 'unclassified' then 7
      when 'candidate_deleted' then 8
      when 'eval_fail' then 9
      else 99
    end,
    created_at
  ))[1] as keep_id
  from public.luna_failures
  where message_id is not null
  group by message_id
  having count(*) > 1
) d
where f.message_id = d.message_id
  and f.id <> d.keep_id;

-- 5) 유니크 인덱스 교체: (message_id, signal) → message_id
drop index if exists public.luna_failures_message_signal_uidx;

create unique index if not exists luna_failures_message_uidx
  on public.luna_failures (message_id)
  where message_id is not null;

commit;
