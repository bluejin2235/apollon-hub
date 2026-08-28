# 02. DB 사용 현황 (`luna_*`)

조사일: 2026-08-18. 코드 미수정. 검색: `.from("luna_…")`, `rpc("luna_…)`, `supabase/migrations/luna_*.sql`.

`components/`는 테이블을 직접 건드리지 않는다. UI는 API만 호출한다.

---

## RPC

### `luna_bump_usage` — `luna_usage_daily` 쓰기
정의: `supabase/migrations/luna_model_cost_sabc.sql:50`  
호출: `lib/luna/engine.ts:237`, 실패 시 `p_feature` 없는 오버로드 `engine.ts:249`

서버 로그에 `PGRST203` 오버로드 충돌이 관측됨(두 시그니처 bigint vs integer).

### `luna_match_learning` — `luna_learnings` 유사도
저장소에 `CREATE FUNCTION` 없음.  
호출: `app/api/luna/learn/route.ts:122` (없으면 warn 후 계속)

### `luna_match_report` — `luna_reports`
저장소에 `CREATE FUNCTION` 없음.  
호출: `lib/luna/selfstudy.ts:1154`. 실패 시 테이블 스캔 `selfstudy.ts:1170`

---

## 테이블별 읽기/쓰기

표기: **R** 읽기, **W** insert/update/upsert/delete.

### `luna_conversations`
CREATE: `luna_tables.sql:5`

- **R** `app/api/luna/chat/route.ts:653` · `conversations/route.ts:31` · `conversations/title/route.ts:40` · `reflect/route.ts:306` · `talk/history/route.ts:85` · `talk/metrics/route.ts:88` · `talk/teach/route.ts:63` · `talk/thumbs/route.ts:105` · `upload/route.ts:65` · `lib/luna/conversation-title.ts:40` · `dashboard.ts:155,409,414,419` · `message-feedback.ts:61` · `selfstudy.ts:434,646`
- **W** `chat/route.ts:1077` update · `conversations/route.ts:90` insert, `:173` update, `:215` delete · `reflect/route.ts:232,245,290` · `analysis.ts:275` · `conversation-title.ts:112`

### `luna_messages`
CREATE: `luna_tables.sql:28`

- **R** `chat/route.ts:1025` · `reflect/route.ts:321` · `talk/history/route.ts:128` · `talk/metrics/route.ts:93` · `talk/teach/route.ts:78` · `talk/thumbs/route.ts:63,129` · `app/luna/page.tsx:133` (클라) · `conversation-title.ts:49,57,65` · `dashboard.ts:64` · `message-feedback.ts:44` · `model-modes.ts:620` · `self-report.ts:165` · `selfstudy.ts:454,631` · `talk-metrics.ts:210` · `trace-weekly.ts:145,169` · `weekly-goals.ts:250` · `wiki-private-alert.ts:55`
- **W** `chat/route.ts:1135,1271,1410,2343` insert · `analysis.ts:868` insert · `message-feedback.ts:104` update

### `luna_learnings`
CREATE: `luna_tables.sql:66`. 가장 많이 쓰임.

- **R** `chat/route.ts:903` · `run-chat.ts:503` · `learn/route.ts:104,152,182` · `knowledge/route.ts` 다수 · `candidates/*` · `popup/*` · `teach/*` · `dashboard.ts` 집계 · `consolidate.ts:283,404` · `selfstudy.ts:191,970` · 외 다수
- **W** `candidates.ts:228` insert · `candidates/respond/route.ts` update/delete · `chat/route.ts:2233` use_count · `knowledge/route.ts:455,504` · `learn/route.ts:238,366` · `identity/route.ts:68,78` · `questions/route.ts:230` insert · `consolidate.ts:591+` · `knowledge-merge.ts:135,159,179` · `run-chat.ts:669`

### `luna_library`
CREATE: `luna_question_types.sql:31`

- **R** `lib/luna/question-types.ts:418` · `lib/wiki/store.ts:163,200` · `lib/wiki/notify.ts:85`
- **W** `app/api/luna/library/route.ts:108,168` · `lib/wiki/store.ts:326` insert, `:421,509` update, `:487` delete

위키 UI가 주 작성자. `library/route.ts`는 직접 API.

### `luna_prompts` / `luna_prompt_versions` / `luna_prompt_groups`
CREATE는 `luna_*.sql`에 없고 이후 마이그레이션이 ALTER/INSERT.

- **prompts R** `lib/luna/prompts.ts:168,196,228,244` · `chat/route.ts:683,952` · `prompts/route.ts` · `self-upgrade.ts` · `analysis.ts:288` · `dashboard.ts:474`
- **prompts W** `prompts/route.ts:348,400,505,568` · `prompts/revert/route.ts:99` · `self-upgrade.ts:563`
- **versions R** `prompts/route.ts:168` · `prompts/revert/route.ts:57` · `brain/upgrade/route.ts:72` · `self-upgrade.ts:167`
- **versions W** `prompts/route.ts:430` · `revert/route.ts:119` · `verify/route.ts:70` · `self-upgrade.ts:581,660`
- **groups R만** `prompts/route.ts:258`. TS 쓰기 없음.

### `luna_question_types` / `luna_unclassified_questions`
CREATE: `luna_question_types.sql:9,49`

- **types R** `question-types.ts:178` · **W** `question-types/route.ts:117,180`
- **unclassified R** `unclassified/route.ts:33` · **W** `unclassified/route.ts:74` · `question-types.ts:364` insert

### `luna_settings`
CREATE: `luna_consolidation.sql:44`. 키-값 설정.

- **R** `chat/route.ts:936` · `run-chat.ts:526` · `selfstudy.ts:223,337` · `eval-schedule.ts:129` · `model-auto-swap.ts:78` · `notify.ts:67` · `consolidate.ts:173` 외
- **W** `brain/model-cost/route.ts:711,725,907` · `selfstudy/settings/route.ts:95` · `eval-schedule.ts:145` · `self-upgrade.ts:95` · `weekly-goals.ts:545` 외 upsert

### `luna_engine_tiers` / `luna_usage_daily` / `luna_model_changes` / `luna_model_market` / `luna_model_modes`
- **tiers R** `engine.ts:49` · `engine/route.ts:47` · `brain/model-cost/route.ts:140` · **W** `engine/route.ts:178` · `model-auto-swap.ts:266` · `model-modes.ts:839`
- **usage_daily R** `engine/route.ts:58` · `brain/model-cost/route.ts:176` · **W TS 없음** (RPC만)
- **model_changes R** `brain/model-cost/route.ts:364` · **W** `:773` · `model-auto-swap.ts:277` · `model-modes.ts:848`
- **model_market** 단일 파일 `model-market.ts:417` W, `:450+` R
- **model_modes** 단일 파일 `model-modes.ts:645+` R/W

### 평가
`luna_eval_cases` · `luna_eval_runs` · `luna_eval_results` · `luna_eval_daily` · `luna_eval_human_scores`

- cases: `eval/cases/route.ts` CRUD, `eval-exam.ts:635`
- runs: `eval/runs/route.ts:83` insert, `eval-exam.ts:919`
- results: `eval-exam.ts:667+` upsert, `eval/results/route.ts`
- daily: `eval-exam.ts:416` insert, `eval/daily/route.ts`
- human_scores: `eval/human-score/route.ts:50` upsert

### 지식 부가
- `luna_knowledge_sources` CREATE `luna_knowledge_sources.sql:6` — `knowledge/sources/route.ts` R/W, `dashboard.ts:250`
- `luna_learning_versions` CREATE `:36` — `knowledge/route.ts:321` insert
- `luna_learning_settings` CREATE 없음 — `knowledge/settings/route.ts`, `knowledge-merge-gate.ts`
- `luna_consolidation_runs` CREATE `luna_consolidation.sql:23` — `consolidate.ts:358,389`

### 기타
- `luna_attachments` — `upload/route.ts:94` insert, `:169` delete; `chat/route.ts:1009` R
- `luna_projects` — `projects/route.ts` CRUD
- `luna_questions` — `questions/route.ts`만
- `luna_department_lens` CREATE `luna_prompt_code_link.sql:8` — `department-lens.ts:57` R, `department-lens/route.ts:113` upsert
- `luna_named_entities` CREATE `luna_named_entities.sql:5` — **R만** `named-entities.ts:246`. TS 쓰기 없음. 비면 코드 시드
- `luna_reports` — `selfstudy.ts:1170,1203` R, `:1209` use_count
- `luna_selfstudy_queue` — **R만** `selfstudy/history/route.ts:119` (테이블 없을 수 있음 주석)
- `luna_trace_weekly` — `trace-weekly.ts:252` upsert, `:289` R
- `luna_weekly_goals` — `weekly-goals.ts` 전용

---

## 루나가 쓰는 `luna_` 아닌 테이블

| 테이블 | 용도 | 대표 위치 |
|---|---|---|
| `glossary_terms` | KNOW 용어 주입 | `chat/route.ts:920` · `run-chat.ts:514` |
| `profiles` | 역할·부서. **루나 쓰기 없음** | `lib/luna/auth.ts:9` · `chat/route.ts:681` |
| `hub_notifications` | 알림 | `notify.ts:101` insert · `wiki-private-alert.ts:32` R |
| `nas_directory` | Work서버 검색 | `workserver.ts` (luna_ 아님) |

용어 쓰기는 `lib/luna/candidate-glossary.ts:39` → `lib/glossary/duplicate-service.ts`.

---

## SQL에만 있고 TS에 없는 테이블

| 테이블 | 정의 | 비고 |
|---|---|---|
| `luna_skills` | `luna_skills.sql:3` | `.from("luna_skills")` 없음 |
| `luna_skill_proposals` | `luna_skills.sql:33` | TS 참조 없음 |

스킬은 프롬프트 L2 행(`luna_prompts`)과 `perspective_ids`로 동작하는 것으로 보임. **추정:** skills 테이블은 미이관 잔재.

---

## TS에 있으나 거의 안 쓰이거나 선택적

| 참조 | 이유 |
|---|---|
| `luna_selfstudy_queue` | 가드된 읽기 1곳. 쓰기 없음 |
| `luna_named_entities` | 읽기 전용 1파일 + 코드 시드 |
| `luna_prompt_groups` | GET 1곳 |
| `luna_reports` + `luna_match_report` | 자습 1파일, RPC 선택 |
| `luna_match_learning` | learn 1곳, 없어도 동작 |
| `luna_skills` / `luna_skill_proposals` | SQL만 |

단일 구현 파일이라도 **활성**인 것: `luna_model_market`, `luna_model_modes`, `luna_weekly_goals`, `luna_trace_weekly`, `luna_questions`.

---

## CREATE가 `luna_*.sql`에 없는 TS 테이블

라이브 DB에서 먼저 만들어졌거나 다른 마이그레이션에 있음:

`luna_prompts`, `luna_prompt_versions`, `luna_prompt_groups`, `luna_engine_tiers`, `luna_usage_daily`, `luna_eval_cases`, `luna_eval_runs`, `luna_eval_results`, `luna_attachments`, `luna_projects`, `luna_questions`, `luna_learning_settings`, `luna_reports`, `luna_selfstudy_queue`, `luna_trace_weekly`, `luna_weekly_goals`.
