# LUNA 검색 개발 진행표

기준: `66dcb3fd49301089f75ebcf2804ea4cae77bf8eb`. 범위는 색인 → 그룹·관계 → 검색용 파생 정보 → 업무 검색 → 직원 베타다. Make는 이번 범위에서 제외한다.

## 첫 변경 묶음

- 대화·지식에 `data_context = production | synthetic` 구분을 추가한다.
- 기존 P9TEST·role-latency와 새 LUNA-EVAL 대화를 시험용으로 표시하고, 이름을 바꿔도 시험용 이력을 유지한다.
- 시험에서 나온 지식은 보존하되 archived 상태로 격리한다. 확인된 melona 검증 행은 ID와 내용이 함께 맞을 때만 격리한다.
- 실제 채팅과 기존 평가의 지식 주입을 `loadRuntimeLearnings`로 통일한다. 전체 채팅 엔진 통일은 아직 완료하지 않았다.
- 개인 메모·회고·후보 수집·실패 수집·자습에서 시험 대화를 제외한다.
- P9FIX가 남은 기존 메모는 주입하지 않고 실제 대화로 다시 작성할 때 대체한다.
- 관리자 결정 RPC는 service_role 전용, security invoker로 바꾼다. 유효한 슈퍼관리자 actor가 필요하다. 직접 SQL 작업도 actor를 명시해야 한다.
- 관리자 inbox 뷰의 공개 읽기를 차단한다. Hub의 기존 관리자 API를 대체하거나 새로 공개하지 않는다.

## 배포 순서

1. 이 PR의 테스트와 타입 검사를 통과시킨다.
2. 운영에서 아래 읽기 전용 영향 점검 SQL로 대상과 기존 호출 방식을 확인한다.
3. DB 백업·복구 지점을 확보하고 migration을 적용한다.
4. 공개 RPC 권한과 격리 건수를 확인한다.
5. 이 브랜치의 앱을 배포한다. 앱은 새 data_context 컬럼을 요구하므로 DB가 먼저다.
6. 실제 직원 계정으로 기존 지식·개인 메모·관리자 결정 동작을 확인한다.

이 파일 작성 시 운영 migration·배포는 하지 않았다. 새 PR의 Vercel preview가 운영 DB를 공유하면 migration 전 검색 경로에서 새 컬럼 오류가 날 수 있다. preview를 성공 증거로 삼지 않는다.

### 되돌리기

앱 코드만 이전 버전으로 되돌려도 추가 컬럼은 기존 코드와 호환된다. 보안 권한을 다시 공개하거나 합성 지식을 재활성화하는 자동 rollback은 제공하지 않는다. 합성으로 잘못 분류한 자료는 출처를 검수해 별도의 운영 지식으로 등록한다. 원본 합성 행은 감사 기록으로 남긴다.

## 다음 개발 순서와 남은 검증

| 순서 | 상태 | 다음 완료 조건 |
|---|---|---|
| 1. 기준·격리·권한 | 이 변경 묶음 | CI + 운영 영향 검토 + migration/배포 검증 |
| 2. 1차 색인 | 대기 | 대표 프로젝트의 실제 파일 대비 누락·갱신·삭제 반영 검증 |
| 3. 그룹·관계 | 대기 | 프로젝트 혼동 없이 근거 있는 소속·동일·버전 관계 검증 |
| 4. 검색용 파생 정보 | 대기 | 원천 ID·버전·생성 시점·갱신 조건 보존 |
| 5. 업무 검색 | 대기 | 오타/별칭/속성/복합 조건/후속 질문에 올바른 자료 전달 |
| 6. 실제 경로 평가 | 기준 준비 중 | 실제 채팅과 같은 핵심 경로, 변경 전후 비교와 되돌리기 |
| 7. 직원 베타 | 대기 | 실제 업무 성공과 지연·오탐 확인 후 확대 |

범위를 넓히기 전에 해운대스퀘어·고래쇼·수원 사례를 고정 회귀 자료로 사용한다. 아래 평가 계약은 합성 테스트용이며 실제 직원 사용량·개인 기억에 넣지 않는다.

## 회사 PC에서만 필요한 확인

- `D:\Dev\apollon-hub`의 미커밋 diff를 보존하고 이 브랜치와 충돌 여부를 확인한다. 작업 트리를 강제로 초기화하지 않는다.
- 실제 실행 중인 NAS/본문/이미지 스캐너 파일과 스케줄러 설정, 실행 SHA를 확인한다.
- 사내 계정으로 검색 결과의 NAS 파일이 열리는지 확인한다.

이 외 소스 수정·SQL 검증·검색 회귀 시험은 GitHub 작업 브랜치에서 진행한다.

## 읽기 전용 영향 점검

```sql
select id, title from public.luna_conversations
where title like '[P9TEST:%' or title like '[role-latency-%' or title like '[LUNA-EVAL:%';
select id, status, source_conversation_id, meta from public.luna_learnings
where id='89100bd6-dd28-4a42-8e02-6284bc9ebc36'
   or meta->>'is_test'='true' or meta->>'data_context'='synthetic'
   or coalesce(btrim(meta->>'test_run_id'),'')<>'';
select item_type, decision, decided_via, count(*) from public.luna_decisions
group by item_type, decision, decided_via;
select p.oid::regprocedure, p.prosecdef,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as staff_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='luna_inbox_decide';
```

참고: https://supabase.com/docs/guides/database/functions
