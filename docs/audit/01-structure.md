# 01. 루나 폴더·파일 구조

조사일: 2026-08-18. 코드 미수정. 줄 수는 PowerShell `Measure-Object -Line`(비어 있지 않은 줄). **300줄 이상**은 `⚠` 표시.

백업 태그: `backup-before-luna-audit-260818`

---

## 범위

루나 제품 코드는 아래 다섯 축이다.

| 축 | 경로 | 역할 |
|---|---|---|
| 채팅 UI | `app/luna/`, `components/luna/` | `/luna` 화면 |
| HTTP API | `app/api/luna/` | 채팅·설정·지식·평가 |
| 야간 작업 | `app/api/cron/luna-*` | 자습·평가·아침요약 등 |
| 도메인 로직 | `lib/luna/` | 파이프라인·LLM·지식·모델 |
| 설정 셸 | `components/settings/luna-*`, `components/luna/LunaSettingsHome.tsx` | `/settings?tab=luna` |

연관(루나가 읽거나 쓰는 인접 코드): `lib/wiki/*`(KNOW 위키), `lib/auth/get-api-user.ts`(서비스 키), `app/layout.tsx:4,46`(전역 `LunaLearnButton`), `public/luna/`(얼굴 에셋), `supabase/migrations/luna_*.sql`, `docs/luna-mockups/`.

`docs/luna-pipeline-design.md`는 저장소에 **없다**.

---

## 300줄 이상 파일 (내림차순)

| 줄 | 파일 |
|---:|---|
| 2286 | `components/luna/brain/LunaBrainModel.tsx` ⚠ |
| 2275 | `app/api/luna/chat/route.ts` ⚠ |
| 1546 | `components/settings/luna-settings-tab.tsx` ⚠ |
| 1500 | `components/luna/LunaMessage.tsx` ⚠ |
| 1236 | `components/luna/talk/LunaTalkSources.tsx` ⚠ |
| 1131 | `lib/luna/selfstudy.ts` ⚠ |
| 1114 | `lib/luna/model-modes.ts` ⚠ |
| 1059 | `lib/luna/eval-exam.ts` ⚠ |
| 995 | `components/luna/brain/LunaBrainEval.tsx` ⚠ |
| 961 | `components/luna/LunaChat.tsx` ⚠ |
| 949 | `components/luna/LunaLearnButton.tsx` ⚠ |
| 939 | `components/settings/luna-eval-tab.tsx` ⚠ |
| 873 | `app/api/luna/brain/model-cost/route.ts` ⚠ |
| 828 | `app/luna/page.tsx` ⚠ |
| 822 | `lib/luna/analysis.ts` ⚠ |
| 818 | `components/luna/candidates/LunaCandidatesPending.tsx` ⚠ |
| 788 | `lib/luna/knowledge-duplicate.ts` ⚠ |
| 759 | `lib/luna/weekly-goals.ts` ⚠ |
| 737 | `components/settings/luna-teach-tab.tsx` ⚠ |
| 729 | `components/luna/brain/LunaBrainPrompts.tsx` ⚠ |
| 726 | `lib/luna/notion.ts` ⚠ |
| 702 | `components/settings/luna-knowledge-tab.tsx` ⚠ |
| 692 | `lib/luna/dashboard.ts` ⚠ |
| 668 | `lib/luna/self-upgrade.ts` ⚠ |
| 663 | `app/api/luna/candidates/respond/route.ts` ⚠ |
| 662 | `lib/luna/workserver.ts` ⚠ |
| 657 | `lib/luna/consolidate.ts` ⚠ |
| 656 | `lib/luna/llm/client.ts` ⚠ |
| 651 | `lib/luna/run-chat.ts` ⚠ |
| 640 | `components/luna/LunaSettingsHome.tsx` ⚠ |
| 544 | `components/settings/luna-trace-tab.tsx` ⚠ |
| 526 | `components/settings/luna-nas-tab.tsx` ⚠ |
| 523 | `components/luna/talk/LunaTalkHistory.tsx` ⚠ |
| 517 | `app/api/luna/prompts/route.ts` ⚠ |
| 508 | `components/luna/brain/LunaBrainReport.tsx` ⚠ |
| 493 | `lib/luna/self-report.ts` ⚠ |
| 482 | `app/api/luna/candidates/route.ts` ⚠ |
| 475 | `lib/luna/nas-path.ts` ⚠ |
| 474 | `lib/luna/model-market.ts` ⚠ |
| 463 | `lib/luna/question-types.ts` ⚠ |
| 458 | `components/luna/LunaSidebar.tsx` ⚠ |
| 457 | `app/api/luna/knowledge/route.ts` ⚠ |
| 452 | `app/api/luna/knowledge/sources/route.ts` ⚠ |
| 441 | `app/api/luna/reflect/route.ts` ⚠ |
| 430 | `components/luna/candidates/shared.tsx` ⚠ |
| 423 | `components/luna/LunaInput.tsx` ⚠ |
| 417 | `lib/luna/eval-schedule.ts` ⚠ |
| 413 | `lib/luna/morning-summary.ts` ⚠ |
| 396 | `components/luna/candidates/KnowledgeReviewCard.tsx` ⚠ |
| 389 | `lib/luna/answer-render.ts` ⚠ |
| 381 | `components/luna/knowledge/LunaKnowledgeWiki.tsx` ⚠ |
| 381 | `components/luna/knowledge/LunaKnowledgeWorkserver.tsx` ⚠ |
| 374 | `app/api/luna/learn/route.ts` ⚠ |
| 354 | `components/luna/brain/LunaBrainTypes.tsx` ⚠ |
| 351 | `components/settings/luna-engine-tab.tsx` ⚠ |
| 342 | `app/api/luna/talk/history/route.ts` ⚠ |
| 333 | `components/luna/selfstudy/LunaSelfstudySettings.tsx` ⚠ |
| 333 | `components/luna/knowledge/LunaConsolidateBox.tsx` ⚠ |
| 322 | `lib/luna/candidates.ts` ⚠ |
| 317 | `components/luna/brain/LunaBrainUpgrade.tsx` ⚠ |
| 311 | `lib/luna/model-auto-swap.ts` ⚠ |

---

## `app/luna/` — 채팅 페이지

| 줄 | 파일 | 역할 |
|---:|---|---|
| 25 | `app/luna/layout.tsx` | 포털 세션 검사 후 헤더+본문. `useRequirePortalSession` `layout.tsx:11` |
| 828 | `app/luna/page.tsx` ⚠ | `/luna` 본체. `sendMessage`가 `POST /api/luna/chat` 호출 `page.tsx:391` |
| 7 | `app/luna/learn/page.tsx` | `/luna/learn` 스텁 「학습 메뉴 준비 중」 `learn/page.tsx:1` |

---

## `app/api/luna/` — HTTP API

### 채팅·대화

| 줄 | 파일 | 역할 |
|---:|---|---|
| 2275 | `app/api/luna/chat/route.ts` ⚠ | 실시간 답변 파이프라인. `POST` `route.ts:604` |
| 198 | `app/api/luna/conversations/route.ts` | 대화 목록·생성·이름·삭제 |
| 52 | `app/api/luna/conversations/title/route.ts` | 제목 생성 트리거 |
| 61 | `app/api/luna/messages/route.ts` | 메시지 피드백(따봉) 저장 |
| 147 | `app/api/luna/upload/route.ts` | 채팅 첨부 업로드 |
| 175 | `app/api/luna/projects/route.ts` | 대화 묶음 프로젝트 CRUD |
| 441 | `app/api/luna/reflect/route.ts` ⚠ | 대화 종료 후 학습 포착 `learn.capture` |

### 지식·후보·팝업

| 줄 | 파일 | 역할 |
|---:|---|---|
| 374 | `app/api/luna/learn/route.ts` ⚠ | 배우기/팝업 학습 확정 |
| 81 | `app/api/luna/popup/pending/route.ts` | 대기 팝업 질문 |
| 176 | `app/api/luna/popup/respond/route.ts` | 팝업 응답 |
| 247 | `app/api/luna/questions/route.ts` | 인라인 질문 생성 |
| 482 | `app/api/luna/candidates/route.ts` ⚠ | 지식후보 목록·처리 |
| 103 | `app/api/luna/candidates/create/route.ts` | 후보 수동 생성 |
| 663 | `app/api/luna/candidates/respond/route.ts` ⚠ | 맞아요/아니에요 |
| 159 | `app/api/luna/candidates/mine/route.ts` | 내 후보 |
| 224 | `app/api/luna/candidates/history/route.ts` | 후보 이력 |
| 87 | `app/api/luna/candidates/rejects/route.ts` | 거절 이유 |
| 457 | `app/api/luna/knowledge/route.ts` ⚠ | 확정 지식 CRUD |
| 452 | `app/api/luna/knowledge/sources/route.ts` ⚠ | 지식 출처 |
| 243 | `app/api/luna/knowledge/conflicts/route.ts` | 충돌 목록 |
| 121 | `app/api/luna/knowledge/resolve/route.ts` | 충돌 해소 |
| 46 | `app/api/luna/knowledge/merge/route.ts` | 병합 실행 |
| 160 | `app/api/luna/knowledge/settings/route.ts` | 지식 설정 |
| 165 | `app/api/luna/library/route.ts` | `luna_library` 직접 CRUD(위키 UI와 병행) |
| 73 | `app/api/luna/identity/route.ts` | identity 학습 행 |

### 가르치기(레거시 teach API)

| 줄 | 파일 | 역할 |
|---:|---|---|
| 103 | `app/api/luna/teach/list/route.ts` | 가르치기 목록 |
| 169 | `app/api/luna/teach/review/route.ts` | 검토 |
| 93 | `app/api/luna/teach/resolve/route.ts` | 해소 |
| 72 | `app/api/luna/teach/conflict/route.ts` | 충돌 |
| 48 | `app/api/luna/teach/retire/route.ts` | 폐기 |

### 두뇌·프롬프트·엔진

| 줄 | 파일 | 역할 |
|---:|---|---|
| 517 | `app/api/luna/prompts/route.ts` ⚠ | 프롬프트 CRUD |
| 134 | `app/api/luna/prompts/revert/route.ts` | 버전 되돌리기 |
| 78 | `app/api/luna/prompts/verify/route.ts` | 프롬프트 검증 |
| 179 | `app/api/luna/engine/route.ts` | 엔진 티어 조회/수정 |
| 873 | `app/api/luna/brain/model-cost/route.ts` ⚠ | 모델·비용 |
| 139 | `app/api/luna/brain/usage/route.ts` | 사용량 |
| 216 | `app/api/luna/brain/upgrade/route.ts` | 자가개선 제안 승인 |
| 140 | `app/api/luna/brain/reports/route.ts` | 두뇌 리포트 |
| 101 | `app/api/luna/brain/goals/route.ts` | 주간 목표 |
| 128 | `app/api/luna/department-lens/route.ts` | 부서 렌즈 |
| 199 | `app/api/luna/question-types/route.ts` | 질문 유형 |
| 82 | `app/api/luna/unclassified/route.ts` | 미분류 질문 |
| 47 | `app/api/luna/dashboard/route.ts` | 대시보드 JSON |

### 평가·자습·대화 통계

| 줄 | 파일 | 역할 |
|---:|---|---|
| 165 | `app/api/luna/eval/cases/route.ts` | 시험 문항 |
| 137 | `app/api/luna/eval/runs/route.ts` | 시험 런 |
| 68 | `app/api/luna/eval/run-one/route.ts` | 한 문항 실행 |
| 48 | `app/api/luna/eval/exam/route.ts` | 시험 일괄 |
| 184 | `app/api/luna/eval/results/route.ts` | 결과 |
| 38 | `app/api/luna/eval/finalize/route.ts` | 런 마감 |
| 60 | `app/api/luna/eval/human-score/route.ts` | 사람 점수 |
| 162 | `app/api/luna/eval/daily/route.ts` | 일일 평가 팝업 데이터 |
| 149 | `app/api/luna/eval/schedule/route.ts` | 평가 스케줄 |
| 59 | `app/api/luna/selfstudy/route.ts` | 자습 수동 실행 |
| 7 | `app/api/luna/selfstudy/pick/route.ts` | 410 gone |
| 7 | `app/api/luna/selfstudy/run/route.ts` | 410 gone |
| 208 | `app/api/luna/selfstudy/history/route.ts` | 자습 이력 |
| 103 | `app/api/luna/selfstudy/settings/route.ts` | 자습 설정 |
| 77 | `app/api/luna/selfstudy/stuck/route.ts` | 막힘 |
| 50 | `app/api/luna/self-report/route.ts` | 주간 셀프 리포트 |
| 54 | `app/api/luna/self-upgrade/route.ts` | 자가개선 실행 |
| 182 | `app/api/luna/consolidate/route.ts` | 지식 정리 실행 |
| 342 | `app/api/luna/talk/history/route.ts` ⚠ | 대화 이력(관리) |
| 217 | `app/api/luna/talk/metrics/route.ts` | 대화 지표 |
| 152 | `app/api/luna/talk/thumbs/route.ts` | 따봉 목록 |
| 108 | `app/api/luna/talk/teach/route.ts` | 대화에서 가르치기 |
| 70 | `app/api/luna/trace/route.ts` | 트레이스(주간) |

### NAS

| 줄 | 파일 | 역할 |
|---:|---|---|
| 93 | `app/api/luna/nas/route.ts` | NAS 설정 |
| 177 | `app/api/luna/nas/paths/route.ts` | 중요 경로 |
| 23 | `app/api/luna/nas/paths/apply/route.ts` | 경로 적용 |
| 116 | `app/api/luna/nas/overview/route.ts` | NAS 개요 |

`.bak` 잔존: `selfstudy/route.phase5.bak`(113), `pick/route.phase5.bak`(43), `run/route.phase5.bak`(68).

---

## `app/api/cron/` — 야간·주기

| 줄 | 파일 | 역할 |
|---:|---|---|
| 39 | `luna-selfstudy/route.ts` | 일일 자습 → `runDailySelfstudy` |
| 102 | `luna-selfstudy/route.phase5.bak` | 이전 구현 백업(컴파일 안 됨) |
| 83 | `luna-eval/route.ts` | 평가 폴러 |
| 48 | `luna-eval-light/route.ts` | deprecated 별칭 |
| 48 | `luna-eval-heavy/route.ts` | deprecated 별칭 |
| 39 | `luna-morning/route.ts` | 아침 요약 |
| 36 | `luna-self-upgrade/route.ts` | 프롬프트 자가개선 |
| 36 | `luna-self-report/route.ts` | 주간 리포트 |
| 42 | `luna-consolidate/route.ts` | 지식 정리 |
| 61 | `luna-knowledge-merge/route.ts` | 지식 병합 게이트 |
| 81 | `luna-model-inspect/route.ts` | 모델 시세·교체 검사 |
| 36 | `luna-trace-weekly/route.ts` | 주간 트레이스 |

---

## `lib/luna/` — 도메인

| 줄 | 파일 | 역할 |
|---:|---|---|
| 2275 경로의 짝 | `run-chat.ts` ⚠ 651 | 비스트리밍 단일 턴. eval/자습용 `runLunaTurn` `:369` |
| 822 | `analysis.ts` ⚠ | 다중 관점 분석 파이프라인 `runAnalysisPipeline` `:227` |
| 656 | `llm/client.ts` ⚠ | Anthropic/OpenAI/Gemini 호출 `lunaLlmComplete` `:356` |
| 246 | `engine.ts` | 티어 모델·사용량 RPC `getTierModel` `:43`, `bumpUsageDaily` |
| 285 | `prompts.ts` | DB 프롬프트 로드 `getPrompt` / `LUNA_PROMPT_KEYS` |
| 135 | `prompt-fallbacks.ts` | DB 없을 때 하드코딩 프롬프트 |
| 150 | `prompt-stages.ts` | 두뇌 UI 1~7단계 정의 `PROMPT_STAGES` `:26` |
| 146 | `prompt-cache.ts` | Anthropic 캐시 블록 조립 |
| 5 | `constants.ts` | `LUNA_DEFAULT_IDENTITY_PROMPT` `:2` |
| 463 | `question-types.ts` ⚠ | 유형 판정·카탈로그 |
| 202 | `connector-routing.ts` | 커넥터 자동 선택 `resolveConnectorsAuto` `:68` |
| 32 | `question-intent.ts` | 개념/프로세스 질문·되묻기 스킵 |
| 248 | `knowledge-match.ts` | 키워드 분할·지식/용어 매칭 |
| 247 | `wiki-match.ts` | 위키 절 매칭 `matchWikiSections` `:115` |
| 38 | `wiki-permissions.ts` | 위키 권한 판정 |
| 72 | `wiki-private-alert.ts` | 비공개 위키 과다 사용 알림 |
| 726 | `notion.ts` ⚠ | 노션 검색 |
| 662 | `workserver.ts` ⚠ | NAS 경로 검색 |
| 224 | `workserver-explore.ts` | LLM 툴로 폴더 탐색 |
| 95 | `tavily.ts` | 웹 검색 |
| 59 | `youtube.ts` | 유튜브 검색 |
| 475 | `nas-path.ts` ⚠ | NAS 카드 경로 표시 |
| 322 | `candidates.ts` ⚠ | 후보 생성 |
| 244 | `candidate-format.ts` | 후보 UI 문구 |
| 106 | `candidate-glossary.ts` | 후보→용어사전 |
| 12 | `candidate-types.ts` | 후보 타입 |
| 221 | `capture-glossary.ts` | 포착 시 용어 추출 |
| 788 | `knowledge-duplicate.ts` ⚠ | 지식 중복 판정 |
| 171 | `knowledge-merge.ts` | 지식 병합 LLM |
| 129 | `knowledge-merge-gate.ts` | 병합 실행 조건 |
| 141 | `knowledge-sources.ts` | 출처 정규화 |
| 114 | `knowledge-format.ts` | 지식 UI 색·날짜 |
| 56 | `knowledge-dump-guard.ts` | 지식 나열 방지 |
| 657 | `consolidate.ts` ⚠ | 야간 지식 정리 |
| 239 | `consolidate-terms.ts` | 용어 분리 |
| 1131 | `selfstudy.ts` ⚠ | 일일 자습 |
| 11 | `selfstudy-gone.ts` | pick/run 410 |
| 27 | `selfstudy-types.ts` | 자습 타입 |
| 493 | `self-report.ts` ⚠ | 주간 셀프 리포트 |
| 668 | `self-upgrade.ts` ⚠ | 프롬프트 자가개선 |
| 759 | `weekly-goals.ts` ⚠ | 주간 목표 |
| 413 | `morning-summary.ts` ⚠ | 아침 요약 |
| 1059 | `eval-exam.ts` ⚠ | 시험 실행·채점 |
| 417 | `eval-schedule.ts` ⚠ | 평가 시각 |
| 14 | `eval-labels.ts` | 평가 라벨 |
| 1114 | `model-modes.ts` ⚠ | 모델 모드·교체 |
| 474 | `model-market.ts` ⚠ | 시세 수집 |
| 311 | `model-auto-swap.ts` ⚠ | 자동 교체 |
| 297 | `brain-models.ts` | 모델 카탈로그 |
| 166 | `model-pricing.ts` | 단가 |
| 165 | `model-display-set.ts` | 표시용 모델 집합 |
| 153 | `model-api-ids.ts` | 공급자 모델 ID 조회 |
| 213 | `model-inspect-schedule.shared.ts` | 검사 시각 순수 함수 |
| 1 | `model-inspect-schedule.ts` | shared 재export |
| 692 | `dashboard.ts` ⚠ | 대시보드 집계 |
| 85 | `dashboard-types.ts` | 대시보드 타입 |
| 121 | `department-lens.ts` | 부서→렌즈 |
| 227 | `named-entities.ts` | 고유명사 시드 |
| 121 | `conversation-title.ts` | 대화 제목 LLM |
| 260 | `chat-response.ts` | 스트림 파싱·출처 카운트 |
| 389 | `answer-render.ts` ⚠ | 답변 마크다운 후처리 |
| 88 | `used-prompts.ts` | 사용한 프롬프트 로그 |
| 120 | `message-feedback.ts` | 메시지 피드백 |
| 30 | `feedback.ts` | 피드백 상수 |
| 47 | `reject-note.ts` | 거절 메모 |
| 49 | `reflect-guard.ts` | reflect 중복 방지 |
| 111 | `notify.ts` | `hub_notifications` insert |
| 220 | `talk-metrics.ts` | 대화 지표 계산 |
| 270 | `trace-weekly.ts` | 주간 트레이스 |
| 262 | `settings-nav.ts` | 설정 탭 슬러그 |
| 17 | `auth.ts` | `isSuperAdminUser` `:4` |
| 13 | `cron-times.ts` | 야간 시각 상수 |
| 202 | `connector-routing.ts` | (위와 동일, 목록 중복 없음) |

---

## `components/luna/` — UI

| 줄 | 파일 | 역할 |
|---:|---|---|
| 961 | `LunaChat.tsx` ⚠ | 채팅 셸·스트림 소비 `consumeLunaStreamEvents` `:365` |
| 1500 | `LunaMessage.tsx` ⚠ | 말풍선·출처·후보 카드 |
| 423 | `LunaInput.tsx` ⚠ | 입력·커넥터·첨부 |
| 458 | `LunaSidebar.tsx` ⚠ | 대화 목록 사이드바 |
| 44 | `LunaShell.tsx` | 레이아웃 래퍼 |
| 949 | `LunaLearnButton.tsx` ⚠ | 전역 배우기 팝업 `app/layout.tsx:46` |
| 200 | `LunaEvalDailyPopup.tsx` | 일일 평가 팝업(임포터 없음) |
| 118 | `LunaInlineQuestionCard.tsx` | 인라인 질문 |
| 111 | `LunaMarkdown.tsx` | 채팅 마크다운 |
| 140 | `SafeMarkdown.tsx` | 안전 마크다운 |
| 640 | `LunaSettingsHome.tsx` ⚠ | 설정>LUNA 홈 |
| 110 | `use-luna-pending-question.ts` | 대기 질문 훅 |
| 261 | `WorkserverPathCard.tsx` | NAS 경로 카드 |
| 2286 | `brain/LunaBrainModel.tsx` ⚠ | 두뇌>모델 |
| 995 | `brain/LunaBrainEval.tsx` ⚠ | 두뇌>평가 |
| 729 | `brain/LunaBrainPrompts.tsx` ⚠ | 두뇌>프롬프트 |
| 508 | `brain/LunaBrainReport.tsx` ⚠ | 두뇌>리포트 |
| 354 | `brain/LunaBrainTypes.tsx` ⚠ | 두뇌>유형 |
| 317 | `brain/LunaBrainUpgrade.tsx` ⚠ | 두뇌>자가개선 |
| 231 | `brain/LunaBrainLibrary.tsx` | 두뇌>라이브러리 UI(임포터 없음) |
| 126 | `brain/LunaDepartmentLens.tsx` | 부서 렌즈 UI |
| 110 | `brain/LunaRejectReasons.tsx` | 거절 이유 UI |
| 202 | `brain/shared.tsx` | 두뇌 fetch 헬퍼 |
| 818 | `candidates/LunaCandidatesPending.tsx` ⚠ | 후보 대기 |
| 241 | `candidates/LunaCandidatesMine.tsx` | 내 후보 |
| 229 | `candidates/LunaCandidatesHistory.tsx` | 후보 이력 |
| 396 | `candidates/KnowledgeReviewCard.tsx` ⚠ | 지식 검토 카드 |
| 144 | `candidates/TermReviewCard.tsx` | 용어 검토 카드 |
| 430 | `candidates/shared.tsx` ⚠ | 후보 공통 |
| 381 | `knowledge/LunaKnowledgeWiki.tsx` ⚠ | 설정>지식>위키 |
| 381 | `knowledge/LunaKnowledgeWorkserver.tsx` ⚠ | Work서버 지식 |
| 143 | `knowledge/LunaKnowledgeNotion.tsx` | 노션 지식 |
| 60 | `knowledge/LunaKnowledgeGlossary.tsx` | 용어 탭 래퍼 |
| 296 | `knowledge/LunaKnowledgeConflict.tsx` | 충돌 UI |
| 333 | `knowledge/LunaConsolidateBox.tsx` ⚠ | 정리 실행 박스 |
| 268 | `knowledge/ui.tsx` | 지식 UI 원자 |
| 333 | `selfstudy/LunaSelfstudySettings.tsx` ⚠ | 자습 설정 |
| 197 | `selfstudy/LunaSelfstudyHistory.tsx` | 자습 이력 |
| 267 | `selfstudy/LunaSelfstudyStuck.tsx` | 막힘 |
| 126 | `selfstudy/shared.tsx` | 자습 공통 |
| 1236 | `talk/LunaTalkSources.tsx` ⚠ | 대화>출처 |
| 523 | `talk/LunaTalkHistory.tsx` ⚠ | 대화 이력 |
| 208 | `talk/LunaTalkMetrics.tsx` | 대화 지표 |
| 129 | `talk/LunaTalkThumbs.tsx` | 따봉 |

---

## `components/settings/` — 설정 탭 (일부 레거시)

| 줄 | 파일 | 역할 |
|---:|---|---|
| 1546 | `luna-settings-tab.tsx` ⚠ | LUNA 설정 라우터. 신규 화면으로 위임 `:17` 부근 |
| 146 | `luna-settings-nav.tsx` | 설정 서브내비 |
| 702 | `luna-knowledge-tab.tsx` ⚠ | 지식 탭(사용 중) |
| 351 | `luna-engine-tab.tsx` ⚠ | 구 엔진 탭 → `LunaBrainModel`로 대체 |
| 939 | `luna-eval-tab.tsx` ⚠ | 구 평가 탭 → `LunaBrainEval` |
| 526 | `luna-nas-tab.tsx` ⚠ | 구 NAS 탭 → `LunaKnowledgeWorkserver` |
| 737 | `luna-teach-tab.tsx` ⚠ | 구 가르치기 탭 → 후보 UI |
| 544 | `luna-trace-tab.tsx` ⚠ | 구 트레이스 탭. gone API 호출 |

---

## 인접 파일

| 줄 | 파일 | 역할 |
|---:|---|---|
| — | `app/layout.tsx:4,46` | 전역 `LunaLearnButton` |
| 39 | `lib/research/luna-system-prompt.ts` | 리서치 채팅용 루나 프롬프트(채팅 파이프라인과 별개) |
| 492 | `lib/wiki/store.ts` ⚠ | `luna_library` 로드. KNOW가 사용 |
| 140 | `lib/wiki/notify.ts` | 위키/라이브러리 알림 |
| 34 | `lib/wiki/api.ts` | 위키 API 게이트 |
| — | `public/luna/luna-face.png`, `luna-blink.webp`, `luna-play.webp` | 배우기 버튼 에셋 |

SQL: `supabase/migrations/luna_*.sql` 약 30파일. 목업: `docs/luna-mockups/*.html`.
