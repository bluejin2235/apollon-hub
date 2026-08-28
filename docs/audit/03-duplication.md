# 03. 중복·데드코드

조사일: 2026-08-18. 코드 미수정. 범위: `lib/luna/**`, `app/api/luna/**`, `app/api/cron/luna*`, `components/luna/**`, `components/settings/luna*`, `app/luna/**`.

동적 import·문자열 라우트는 「추정」으로 표시. grep으로 임포터가 없으면 「사실」.

`createClient(`는 이 범위에 거의 없다. 루나는 `getServiceSupabase()` (`lib/auth/get-api-user.ts:22`)를 쓴다.

---

## 1. 답변 파이프라인 3벌

| 사본 | 파일 | 호출자 |
|---|---|---|
| 제품 채팅(스트림) | `app/api/luna/chat/route.ts:604` | `app/luna/page.tsx:391` |
| eval/자습(비스트림) | `lib/luna/run-chat.ts:369` `runLunaTurn` | `eval-exam.ts:658` · `selfstudy.ts:890` |
| 다중 관점 | `lib/luna/analysis.ts:227` `runAnalysisPipeline` | `chat/route.ts:1098` |

채팅은 `runLunaTurn`을 import하지 않는다. eval/자습은 스트림·첨부·검색 재질의·부서 렌즈·프롬프트 캐시가 없다.

복사된 헬퍼:

| 심볼 | chat/route | run-chat | analysis |
|---|---|---|---|
| `SEARCH_REQUEST_KEYWORDS` | `:141` | `:92` | `:24` |
| `SEARCH_BUDGET_MS` / `MAX_SEARCH_ROUNDS` | `:142-143` | (루프 없음) | `:25-26` |
| `pathLastSegment` / `toNasCard` | `:245-276` | `:119-150` | `:77-101` |
| `parseJsonObject` | `:386-410` | `:158-181` | `:122` |
| `getAnthropicClient` | `:234-243` | `:152-156` | 인자로 받음 |
| `SYNTHESIS_OPINION_FALLBACK` | `:135` | `:86` | — |
| `CLARIFY_FALLBACK` | `:138` | `:89` | — |

`CLARIFY_FALLBACK` 문구가 두 파일에서 이미 갈라짐.

공유 `parseJsonObject`는 `lib/luna/candidates.ts:68`에도 있다. 10곳 이상에서 로컬 복사.

---

## 2. LLM 호출 스택 3개

- `lunaLlmComplete` `lib/luna/llm/client.ts:356` — 분류 등. chat `:1171`, run-chat `:429`
- raw `client.messages.create` — 되묻기·키워드·self-eval·requery·synthesis·최종답. chat `:1316,1453,1724,1786,1874` · run-chat `:645`
- `llmStreamText` `client.ts:643` — 비 Anthropic 스트림. chat `:2171`

`getAnthropicClient()`가 chat, run-chat, reflect (`reflect/route.ts:27` 부근), candidates, consolidate, self-report, self-upgrade, conversation-title에 복사. `llm/client.ts:55` `anthropicClient()`와 중복.

---

## 3. 인증 보일러플레이트

`getServiceSupabase` + `isSuperAdminUser` (`lib/luna/auth.ts:4`) + `NextResponse.json({ error })`가 슈퍼관리자 API 20곳 이상에 로컬 `requireSuperAdmin`으로 반복. 예: `selfstudy/route.ts:12`, `prompts/route.ts:53`, `library/route.ts:14`.

---

## 4. import되지 않는 파일 (사실)

| 파일 | 근거 |
|---|---|
| `components/luna/LunaEvalDailyPopup.tsx:46` | 다른 ts/tsx import 없음. `/api/luna/eval/daily` 유일 소비자 |
| `components/luna/brain/LunaBrainLibrary.tsx:38` | import 없음. API `library/route.ts`는 살아 있음 |
| `components/settings/luna-engine-tab.tsx:61` | `luna-settings-tab.tsx`가 `LunaBrainModel` 사용 |
| `components/settings/luna-eval-tab.tsx:129` | `LunaBrainEval`로 대체 |
| `components/settings/luna-nas-tab.tsx:83` | `LunaKnowledgeWorkserver`로 대체 |
| `components/settings/luna-teach-tab.tsx:93` | 후보 UI로 대체 |
| `components/settings/luna-trace-tab.tsx:63` | 유일 호출: gone API `pick`/`run` `:198,:227` |

슬러그 리다이렉트는 `lib/luna/settings-nav.ts:128-145` (`teach`→candidates 등). 구 탭 파일은 남음.

HTTP라 임포트되지 않지만 라우트는 존재:

| 파일 | 메모 |
|---|---|
| `app/luna/learn/page.tsx:1` | 「준비 중」 |
| `app/api/luna/selfstudy/pick/route.ts` · `run/route.ts` | 410 `lunaSelfstudyGone` |
| `app/api/cron/luna-eval-light/route.ts:13` · `heavy` | deprecated. `vercel.json`에 없음 |
| `*.phase5.bak` | 컴파일 안 됨 |

---

## 5. 파일 밖으로 안 불리는 export (사실)

| export | 위치 |
|---|---|
| `withFallback` | `lib/luna/prompts.ts:80` |
| `LUNA_PROMPT_KEYS.search` (`talk.search`) | `prompts.ts:21` — 키 읽기 없음. 문자열 리터럴은 `eval-exam.ts:55`, `self-upgrade.ts:37` |
| `selectLearningsForInject` | `knowledge-dump-guard.ts:23` — 채팅은 `pickLearningsForQuestion` |
| `typePromptKeys` | `question-types.ts:345` |
| `normalizeClassification` (question-types 사본) | `question-types.ts:478` — 호출은 `chat-response.ts:187` |
| `formatLearningsBlock` | `prompt-cache.ts:121` — 채팅은 `formatMatchedLearningsBlock` |
| `defaultUseCaching` | `prompt-cache.ts:36` |
| `WORKSERVER_STRUCTURE` 별칭 | `prompt-cache.ts:8` |
| `firstTurnFallback` | `candidates.ts:171` |
| `autoGradeAnswerLegacy` | `eval-exam.ts:267` `@deprecated` |
| `prepareLunaAnswerMarkdown` | `answer-render.ts:428` `@deprecated` |
| `buildSearchStatus` | `LunaChat.tsx:498` stub `return []` |
| `anthropicClient` re-export | `llm/client.ts:700` 외부 import 없음 |

파일 내부 전용: `isRetryableLlmFailure` `client.ts:615`, `isConceptProcessQuestion` `question-intent.ts:15`.

---

## 6. 하드코딩 상수 중복

### 모델 ID
- `"claude-sonnet-4-6"`: `run-chat.ts:83` · `engine.ts:25` · `brain-models.ts:27` · `reflect/route.ts:27`
- `"Claude Sonnet 4.6"`: `run-chat.ts:84` · `engine.ts:26`
- `"claude-haiku-4-5-20251001"`: `brain-models.ts:32` · `llm/client.ts:27`

채팅은 `getTierModel`(`engine.ts:43`). `runLunaTurn`은 티어를 무시하고 `LUNA_MODEL` 고정.

### 크론 시각
정본: `lib/luna/cron-times.ts` (KST 3:00 / 3:30 / 3:40 / 3:50 / 4:00).

어긋남:
- `vercel.json` `luna-eval`은 `*/10 * * * *` (폴러), 3:40/3:50 아님
- `luna-self-upgrade` `0 19 * * 6` = 토 04:00 KST. `cron-times.ts:18` weekday `0`(일)
- `dashboard.ts:28-38` hour `3` / `"03:00"` 하드코딩
- `LunaBrainEval.tsx:201-208` `{ hour: 3, minute: 40/50 }`
- `selfstudy/settings/route.ts:61` `"03:00 (KST)"`
- `LunaSelfstudySettings.tsx:90` `"03:00"`

### 프롬프트
- `constants.ts:2` identity 폴백
- `prompt-fallbacks.ts:1` DB 미스 폴백. `TYPE_FIND_FALLBACK` `:23`이 김
- `LUNA_RUNTIME_PROMPT_KEYS` `prompts.ts:45-66`에 capture/dialogue/selfstudy 등. 채팅은 로드만 하고 안 쓰는 키 있음
- `analysis.supervisor` `analysis.ts:337`은 `LUNA_PROMPT_KEYS`에 없음
- `talk.search`는 FIND에 흡수됐으나 키는 남음 `prompt-fallbacks.ts:22`

### 기타
- `CORRECTION_RE` `selfstudy.ts:47` = `weekly-goals.ts:6`
- `UsedPromptRef` `used-prompts.ts:3` vs `chat-response.ts:171`
- `MAX_KNOWLEDGE_LIST_ITEMS = 10` `knowledge-dump-guard.ts:5` vs 문구 「5건」 `:67`
- 테이블 이름 문자열 `.from("luna_*")` 중앙 모듈 없음
- glossary `deleted_at` 폴백 `chat/route.ts:917-932`와 `run-chat.ts:511-523` 동일

temperature 인자는 루나 LLM 호출에 거의 없음(공급자 기본값).

---

## 7. 쌍 점검

| 쌍 | 결론 |
|---|---|
| `run-chat.ts` vs `chat/route.ts` | **중복 파이프라인.** 제품은 chat |
| `prompt-fallbacks.ts` vs DB | 의도된 폴백. DB 수정 시 코드와 어긋날 수 있음 |
| `constants.ts` vs fallbacks vs `engine.ts` | identity / talk·type 텍스트 / 모델 ID 세 출처 |
| `selfstudy.ts` vs types vs gone | 역할 분리. gone은 pick/run만. 크론 자습은 살아 있음 |
| `dashboard.ts` vs `dashboard-types.ts` | 정상 분리. `dashboard.ts:13` re-export |
