# 05. 위험 요소

조사일: 2026-08-18. 코드 미수정. 범위: `lib/luna/**`, `app/api/luna/**`, `app/api/cron/luna*`, `components/luna/**`, `app/luna/**`.

---

## 1. try-catch 없는 외부 호출

### 근처에 try가 있는 것 (구멍 아님)
- Tavily `lib/luna/tavily.ts:45`, catch `:102`
- YouTube `lib/luna/youtube.ts:29`, catch `:61`
- OpenAI 모델 목록 `model-api-ids.ts:128`, catch `:140`
- Gemini 모델 목록 `model-api-ids.ts:147`, catch `:162`
- Notion 블록 `notion.ts:350`, 호출측 catch `:416`

### 네트워크 throw가 그대로 올라가는 곳

| 파일:줄 | 호출 | 영향 |
|---|---|---|
| `lib/luna/notion.ts:150` | Notion 제목 fetch | `enrichCandidateTitles` `:481`에 catch 없음. `Promise.all` 거부 |
| `lib/luna/notion.ts:535` | `api.notion.com/v1/search` | HTTP `!ok`는 처리, **fetch throw는 아님** |
| `lib/luna/llm/client.ts:172` | OpenAI chat | `completeOpenAI` |
| `lib/luna/llm/client.ts:261` | Gemini generateContent | |
| `lib/luna/llm/client.ts:483` | OpenAI 스트림 | |
| `lib/luna/llm/client.ts:543` | Gemini SSE | |
| `lib/luna/model-market.ts:75` | Artificial Analysis | `:84` try는 JSON.parse만 |
| `lib/luna/llm/client.ts:96` | Anthropic SDK `completeAnthropic` | fetch 아님. SDK throw |
| `lib/luna/llm/client.ts:663` | Anthropic 스트림 | |
| `app/api/luna/chat/route.ts:2132` | `client.messages.stream` | 로컬 try 없음. 바깥 `:2388` |
| `lib/luna/run-chat.ts:645` | 최종 `messages.create` | try 없음 |
| `lib/luna/workserver-explore.ts:146` | `llmComplete` | 이 함수 안 try 없음 |

상속:
- `chat/route.ts:1563` `searchNotionPages` in `Promise.all` — 로컬 try 없음
- `analysis.ts:366,444` 검색 배치
- `run-chat.ts:586` `searchNotionPages`

Work서버 자체 HTTP fetch는 없음(Supabase `nas_directory`).

---

## 2. 환경변수 누락

이 범위에 `process.env.X!` 없음.

### 명시적 throw (키 없음)

| 파일:줄 | 변수 | 메시지 |
|---|---|---|
| `llm/client.ts:56,83` | `hubtrendchat_claude` | `Claude API key is not configured` |
| `llm/client.ts:140,468` | `LUNA_OPENAI_API_KEY` | OpenAI not configured |
| `llm/client.ts:239,532` | `LUNA_GOOGLE_API_KEY` | Gemini not configured |
| `llm/client.ts:656` | `hubtrendchat_claude` | 스트림 |

`lunaLlmComplete` `:376`의 재시도는 missing-key를 retryable로 안 봄 `:395` → 재throw. C 폴백 두 번째 호출 `:426`은 중첩 try 없음.

### throw 없이 요청 실패 / 조용히 스킵

| 변수 | 검사 | 누락 시 |
|---|---|---|
| `SUPABASE_SECRET_KEY` | `lib/auth/get-api-user.ts:24` | `getServiceSupabase()` null. `chat/route.ts:611` **500** `Server configuration error`. **루나 API 전부 불가** |
| `hubtrendchat_claude` | `chat/route.ts:235,616` | 채팅 **500** JSON |
| `CRON_SECRET` | 예 `cron/luna-eval/route.ts:19` | 500 JSON |
| `TAVILY_API_KEY` | `tavily.ts:36` | log + `[]`. 웹 검색은 「한 것처럼」 빈 결과 |
| `NOTION_TOKEN` | `notion.ts:662` | status skipped `no-token` |

존재 플래그만: `engine/route.ts:13`, `brain-models.ts:314`, `dashboard.ts:651`.

관련: `tavily.ts:96` `r.url!.trim()` — url 필터 후 단언.

---

## 3. `any` / `@ts-ignore`

**이 범위에서 `: any`, `as any`, `@ts-ignore`, `@ts-expect-error` 0건.**

타입은 `unknown` + narrowing.

---

## 4. DB가 아닌 코드 하드코딩 프롬프트

`engine.ts`에는 시스템 프롬프트 없음. 모델 폴백 ID만 `engine.ts:24` `claude-sonnet-4-6`.

### `lib/luna/prompt-fallbacks.ts` (DB 미스)

| 줄 | 키 | 앞부분 |
|---|---|---|
| 3 | `search.keyword_extract` | `사용자의 메시지에서 노션·Work서버·웹·유튜브 검색에 쓸 핵심 키워드만…` |
| 6 | `search.requery` | `앞선 검색이 원하는 결과를 주지 못했습니다…` |
| 9 | `eval.self` | `질문과 찾은 자료 제목 목록을 보고…` |
| 12 | `answer.synthesis` | `질문과 소스별 검색 결과를 보고…` |
| 15 | `talk.clarify_guard` | `프로젝트명이 문장에 없으면 인스파이어·해운대·더후…` |
| 18 | `source.workserver_structure` | `[Work서버] T 드라이브는 진행 중 작업…` |
| 23 | `type.find` | `## 커넥터 선택 하나만 고르지 않는다…` |
| 139 | `type.classify` | `질문을 아래 유형 목록과 대조해 판정한다…` |
| 150 | `type.know` | `개념·용어·프로세스·역할을 설명한다.` |
| 156 | `type.make` | `산출물·양식·초안을 만든다.` |
| 162 | `type.learn` | `사용자가 알려준 사실을 받아 적는다.` |

### `lib/luna/constants.ts:2`
`identity.apollon` `LUNA_DEFAULT_IDENTITY_PROMPT`: `당신은 루나(Luna)입니다. 아폴론이머시브웍스의 AI입니다.`

채팅 로드 실패 시 사용: `chat/route.ts:447`.

### 채팅 경로에 항상 붙는 코드 문자열 (`chat/route.ts`)
- `:135` `SYNTHESIS_OPINION_FALLBACK` — 카드 재나열 금지
- `:138` `CLARIFY_FALLBACK` — 되묻기 JSON 지시
- `:458` `KNOWLEDGE_LIST_HARD_RULE`
- `:500` `[웹 검색 보강]…`
- `:508` `[노션 검색 결과]…`
- `:553-560` `buildLocationAnswerRules` + 위치/프로젝트 맥락 규칙

동일 사본: `run-chat.ts:86,89`.

### DB 키가 없거나 폴백만 있는 시스템 문자열

| 파일:줄 | 이름 | 앞부분 |
|---|---|---|
| `knowledge-dump-guard.ts:67` | `KNOWLEDGE_LIST_HARD_RULE` | `한 응답에서 확정 지식을 5건 넘게…` |
| `knowledge-dump-guard.ts:7` | `KNOWLEDGE_DUMP_CLARIFY` | `어떤 주제나 상황에 대한 지식이 필요하신가요?` |
| `notion.ts:630` | `buildLocationAnswerRules` | `[답변 규칙] 위치를 묻는 질문이면…` |
| `workserver-explore.ts:151` | explore system | `Work서버 폴더를 단계적으로 탐색해…` |
| `candidates.ts:50` | `DIALOGUE_FALLBACK` | `후보함에서 사람과 대화할 때의 원칙:` |
| `candidates.ts:314` | inline | `사람이 알려준/포착한 지식을 재진술하고…` |
| `conversation-title.ts:11` | `TITLE_SYSTEM` (DB 없음) | `대화 내용을 보고 짧은 제목을 만드세요.` |
| `eval-exam.ts:69` | `AUTO_GRADE_SYSTEM` | `당신은 LUNA 시험 채점관입니다.` |
| `consolidate.ts:87` | `CONSOLIDATE_SYSTEM` | `당신은 팀 장기 기억을 정리하는 편집자입니다.` |
| `consolidate-terms.ts:7` | `SPLIT_SYSTEM` | `당신은 아폴론 기억을 정리하는 편집자입니다.` |
| `knowledge-merge.ts:5` | `MERGE_FALLBACK` | `당신은 팀 지식을 통합하는 편집자입니다.` |
| `self-upgrade.ts:24` | `UPGRADE_FALLBACK` | `내 판단(프롬프트)을 고칠 수 있는 근거는 세 가지다:` |
| `self-report.ts:28` | `REPORT_FALLBACK` | `매주 성장 루프를 돌린다.` |
| `selfstudy.ts:34` | `SELFSTUDY_FALLBACK` | `오늘 대화 기록에서 "내가 막혔던 순간"만 찾는다:` |
| `knowledge-duplicate.ts:63` | `PROPOSE_FALLBACK` | `두 지식을 비교해 한 가지로 판정한다.` |
| `reflect/route.ts:30` | `REFLECT_SYSTEM_PROMPT_FALLBACK` | `방금 대화에서 배울 것이 있었는지 판정하고…` |
| `reflect/route.ts:59` | `CAPTURE_USER_SUFFIX` | `위 규칙을 따르세요. JSON만 출력하세요.` |

---

## 5. `isSuperAdminUser` 실패 닫힘

`lib/luna/auth.ts:14-16`: 프로필 조회 에러 → `console.error` 후 **`return false`**.

권한 상승은 없다. DB 순간 장애 시 슈퍼관리자가 일반 사용자로 보여 프롬프트/엔진/평가 API가 403. 가용성 위험.

---

## 6. 관측된 운영 이슈 (관련)

- `luna_bump_usage` 오버로드 `PGRST203` — `engine.ts:237` vs `:249`. 사용량 적재가 실패할 수 있음(채팅은 계속됨).
- `runLunaTurn`이 엔진 티어를 무시하고 Sonnet 고정 `run-chat.ts:83` — eval/자습 비용·모델이 채팅과 다름.
- KNOW 위키 매처 `wiki-match.ts:155` 절 제목 필터 — 문서가 있어도 주입에서 탈락할 수 있음(별도 조사 2026-08-18).
