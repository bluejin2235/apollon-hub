# 04. 루나 응답 파이프라인

조사일: 2026-08-18. 코드 미수정.

**`docs/luna-pipeline-design.md`는 저장소에 없다.** 비교 대상은 `docs/luna-mockups/luna-prompts-restructure.html`(「생각의 순서」)와 `lib/luna/prompt-stages.ts:26` `PROMPT_STAGES`.

제품 채팅은 `lib/luna/run-chat.ts`가 아니라 `POST app/api/luna/chat/route.ts`다.

---

## A. UI → API

| 순서 | 파일:줄 | 함수 | 동작 |
|---|---|---|---|
| 1 | `app/luna/layout.tsx:10` | `LunaLayout` | `useRequirePortalSession` |
| 2 | `app/luna/page.tsx:87` | `LunaPage` | 대화·메시지 상태 |
| 3 | `page.tsx:832` | JSX | `LunaChat`에 `onSend` |
| 4 | `components/luna/LunaChat.tsx:531` | `LunaChat` | 입력+목록 |
| 5 | `LunaInput.tsx:233` | `submit` | 커넥터·스킬·첨부 |
| 6 | `LunaChat.tsx:638` | `handleSendWrapped` | 되묻기 선택 반영 후 `onSend` |
| 7 | `page.tsx:391` | `sendMessage` | `POST /api/luna/conversations` 후 **`POST /api/luna/chat`** Bearer |
| 8 | `page.tsx:502` · `LunaChat.tsx:365` | `consumeLunaStreamEvents` | NDJSON `ids`/`step`/`clarify`/`meta` 후 본문 텍스트 |
| 9 | `LunaChat.tsx:972` · `LunaMessage.tsx:1070` | `LunaMessage` | 말풍선 |
| 10 | `page.tsx:736` | 후처리 | `luna_messages` 재조회, `POST /api/luna/conversations/title` |
| 11 | `LunaChat.tsx:50,709` | `callReflect` | 대화 떠난 뒤 **`POST /api/luna/reflect`** (답변 파이프라인 밖) |

요청 바디 `page.tsx:475`: `{ conversation_id, message, connectors, skills, attachment_ids? }`.

스트림 프로토콜 `chat/route.ts:596` `emit`: NDJSON 이벤트 후 `meta`(`:2109`), 이어서 plain text (`:2139`).

다른 진입: `LunaChat.tsx:633` 선택지, `:947` 제안, `page.tsx:797` `?ask=`.

---

## B. `POST /api/luna/chat` (`route.ts:604` ~ `:2409`)

`ReadableStream.start`는 `:1062`.

### 스트림 전

1. 인증 `getApiUser` `:606`, `getServiceSupabase` `:611`, `getAnthropicClient` `:616`
2. `luna_conversations` 소유 확인 `:652`
3. 병렬: 부서, L2 렌즈, `getTierModel` (`engine.ts:43`) A/B `:675`
4. 수동 스킬 없으면 `resolveDepartmentLens` (`department-lens.ts`) `:713`
5. 수동 커넥터 없으면 `resolveConnectorsAuto` (`connector-routing.ts:68`) `:748`
6. 프롬프트 `getPromptRows` / `pickLoaded` identity·classify·keyword·know/find/make… `:787`
7. `loadQuestionTypes`, `loadLibraryItems`, `loadWikiDocs` `:894`
8. `luna_learnings` active `:902`, `glossary_terms` `:917`, web-augment 설정 `:935`
9. 첨부 `:1006`, 최근 메시지 20 `:1024`
10. `isKnowledgeDumpRequest` `:1049`

### 포크

- 관점+역할 ≥ 2 → `runAnalysisPipeline` (`analysis.ts:227`) **return** `:1098`
- 지식 덤프 → clarify 후 close `:1130`

### 본 파이프라인

| # | 코드 주석 | 줄 | 함수 |
|---|---|---|---|
| 0 | 유형 판정 | `1166-1223` | `lunaLlmComplete` (`llm/client.ts:356`) tier C. `parseClassificationJson` `question-types.ts:228`. `resolveClassification` `:270` |
| 0b | 커넥터 덮어쓰기 | `1225-1236` | `typesNeedSearch` `:316`. `applyTypeSearchOverride` `connector-routing.ts:167` |
| 0c | 양식 | `1238` | `typesNeedLibrary` · `matchLibraryItems` `question-types.ts:442` |
| 1 | 되묻기 | `1242-1447` | make+양식 0건이면 clarify return `:1250`. 아니면 tier B `client.messages.create` `:1316` |
| — | 키워드 추출 | `1450-1486` | tier B `messages.create`. **검색 여부와 무관** 주석 `:1450` |
| — | 주입 | `1488-1512` | `splitKeywordQuery` `knowledge-match.ts:88`. `pickLearningsForQuestion` `:154`. `pickGlossaryForQuestion` `:192`. **`matchWikiSections` `wiki-match.ts:115`는 `types`에 `know` 있을 때만** `:1495` |
| — | 웹 보강 | `1514-1532` | `shouldWebAugmentKnow` `knowledge-match.ts:234` |
| 2–5 | 검색 루프 | `1534-1863` | `runConnectorSearch` `:1560`: `searchNotionPages`, `searchTavily`, `searchYoutube`, `exploreWorkserverWithTools`. 최대 `MAX_SEARCH_ROUNDS` `:142`. self-eval `:1724`, requery `:1786` |
| 6a | 소스 이유 | `1865-1922` | synthesis `messages.create` |
| 6b | 답변 | `1924-2206` | `buildAnswerSystem` `:424`. emit `meta` `:2109`. Anthropic `messages.stream` `:2131` 또는 `llmStreamText` `:2171` |
| — | 후처리 | `2208-2262` | 지식·위키 use_count |
| — | 저장 | `2263-2386` | `luna_messages` insert `:2343`. `scheduleConversationTitle`. `checkAndNotifyPrivateWikiOveruse` |

분류만 `lunaLlmComplete`(C). 되묻기·키워드·검색 평가·최종은 A/B Anthropic SDK. identity는 **답변 시스템**에 들어간다(`:1996` / `buildAnswerSystem` `:448`), 첫 LLM 호출이 아니다.

---

## C. `run-chat.ts` 대체 경로

주석 `run-chat.ts:364`: 이력/스킬/첨부 없음, DB 저장 안 함, 회귀·야간용.

호출:
- `lib/luna/selfstudy.ts:890` `answerAndSubmit`
- `lib/luna/eval-exam.ts:658` `executeEvalCase`

순서: dump guard `:385` → 프롬프트/유형/위키 `:395` → classify `lunaLlmComplete` `:429` → `applyTypeSearchOverride` `:452` → `maybeClarify` `:488` → 키워드 `:532` → 지식/용어/위키 `:538` → Notion/Tavily/YouTube/Workserver **직렬** `:585` → 한 번 `messages.create` `:645`. 검색 재질의 루프 없음, 스트림 없음.

크론: `GET /api/cron/luna-selfstudy` → `runDailySelfstudy` `selfstudy.ts:1024`. `GET /api/cron/luna-eval` → `runEvalExam` `eval-exam.ts:854`.

---

## D. 설계 vs 코드

설계 출처: `docs/luna-mockups/luna-prompts-restructure.html:412-417`, `lib/luna/prompt-stages.ts:26-69`.

| 설계 | 코드 |
|---|---|
| 질문을 받으면 1번부터 차례로 (`html:414`) | 실제: 렌즈 → (사전)커넥터 → **classify** → clarify → 키워드 → 주입 → 검색 → 답변. identity는 답변 때 캐시 블록 `route.ts:448` |
| 1단계 「언제나 먼저 읽는다」 `prompt-stages.ts:28` | 첫 LLM은 classify `:1171` |
| 2단계 부서 자동 `prompt-stages.ts:34` | 일치. classify 전 `resolveDepartmentLens` `:713` (수동 스킬 제외) |
| 3단계에서 유형이 경로를 가른다 | 일치하나 커넥터는 **두 번**: classify 전 `:748`, 후 `applyTypeSearchOverride` `:1226` |
| 4번에서 유형 프롬프트 **하나만** (`html:415`) | `classifiedTypeRows` 루프 `:1975`로 **복수** 가능. `types: string[]` |
| KNOW는 검색하지 않는다. 부족하면 웹 (`html:247`) | `needs_search: false` `question-types.ts:78` + override. `shouldWebAugmentKnow` `:1514`. 키워드 LLM은 항상 |
| FIND 4-2-a…e 검색어→구조→self-eval→requery | 검색 루프와 유사. 키워드는 FIND 전용이 아님 `:1450`. Work서버 구조는 **답변 때** 주입 `:2004` |
| MAKE 양식 없으면 되묻기 (`html:275`) | `:1250-1306` |
| LEARN 후보로 올린다 (`html:286`) | 채팅 POST에 후보 생성 없음. `POST /api/luna/reflect` `LunaChat.tsx:50` |
| 5단계 되묻기는 유형 무관 항상 (`html:307`) | 스킵: know/learn/smalltalk `skip_clarify`, 첨부, 직전 clarify, 수동 스킬, `shouldSkipProjectClarify` `:1243` |
| 6단계 답한 뒤 배운다 | chat POST 밖. reflect |
| 7단계 야간 성장 | 크론. 채팅 아님 |
| 인사는 프롬프트 없이 짧게 (`html:290`) | `smalltalk` `prompt_key: null` `question-types.ts:129`. 답변은 여전히 identity+L3 `buildL3PromptBlock` `:1989` |

코드 주석 「단계 0 classify / 1 clarify / 2–5 search / 6 answer」는 설계 1–7과 **번호가 다르다**.

---

## E. 답변을 만드는 다른 경로

| 경로 | 생성기 |
|---|---|
| UI 채팅 | `chat/route.ts` 스트림 또는 `runAnalysisPipeline` |
| 자습 크론/수동 | `runLunaTurn` |
| 평가 크론/API | `runLunaTurn` |
| `POST /api/luna/questions` `:206` | `lunaLlmComplete` — 팝업 질문, 채팅 답 아님 |
| `POST /api/luna/reflect` | 학습 포착 JSON |
| `GET /api/cron/luna-morning` | 요약 알림, Q→A 아님 |
