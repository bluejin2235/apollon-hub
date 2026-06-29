import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_P3_COLLECT_PROMPT,
  fetchCommonGptPromptSetting,
  LEGACY_COMMON_GPT_PROMPT_KEY,
  LEGACY_GPT_CURATOR_PROMPT_KEY,
  P3_COLLECT_PROMPT_KEY,
  resolveCommonGptPrompt
} from "@/lib/research/gpt-curator-prompt";
import {
  DEFAULT_P1_LUNA_PROMPT,
  LEGACY_LUNA_SYSTEM_PROMPT_KEY,
  P1_LUNA_PROMPT_KEY
} from "@/lib/research/luna-system-prompt";

export { P3_COLLECT_PROMPT_KEY } from "@/lib/research/gpt-curator-prompt";
export { P1_LUNA_PROMPT_KEY } from "@/lib/research/luna-system-prompt";

export const P2_TREND_PROMPT_KEY = "p2_trend_prompt";

/** @deprecated `p2_trend_prompt` 이전 키 */
export const LEGACY_CHAT_SELECTION_PROMPT_KEY = "chat_selection_prompt";

/** @deprecated `P2_TREND_PROMPT_KEY` 사용 */
export const CHAT_SELECTION_PROMPT_KEY = P2_TREND_PROMPT_KEY;

export const P4_EDITOR_PROMPT_KEY = "p4_editor_prompt";

export const P1_1_ARTICLE_PROMPT_KEY = "p1_1_article_prompt";

/** @deprecated `p4_editor_prompt` 이전 키 */
export const LEGACY_EDITOR_PROMPT_KEY = "editor_prompt";

/** @deprecated `P4_EDITOR_PROMPT_KEY` 사용 */
export const EDITOR_PROMPT_KEY = P4_EDITOR_PROMPT_KEY;

export const DEFAULT_P2_TREND_PROMPT =
  "아폴론이머시브웍스 팀원들의 채팅방 대화를 분석해서 아폴론의 사업 방향(미디어 아키텍처, 인터랙티브 설치, 몰입형 경험, 브랜드 공간)과 관련된 핵심 아젠다와 키워드를 추출해줘. 위클리 후보로 마킹된 것을 우선으로 하고, 반복 언급된 주제를 중심으로 최대 15개 아젠다를 뽑아줘.";

/** @deprecated `DEFAULT_P2_TREND_PROMPT` 사용 */
export const DEFAULT_CHAT_SELECTION_PROMPT = DEFAULT_P2_TREND_PROMPT;

export const DEFAULT_P4_EDITOR_PROMPT =
  "너는 아폴론이머시브웍스의 AI 편집장이야. 아폴론은 미디어 아키텍처 전문 스튜디오로 We Make Beloved Digital Landmarks가 미션이야. 채팅방 아젠다와 수집사이트 아티클 전체 후보 중에서 아폴론이 실제로 참고하고 영감받을 만한 것 최대 15개를 선정해줘. 선정 기준: 아폴론 프로젝트와 직접 연관성, 새로운 기술/공간 경험 트렌드, 클라이언트 제안서 활용 가능성.";

/** @deprecated `DEFAULT_P4_EDITOR_PROMPT` 사용 */
export const DEFAULT_EDITOR_PROMPT = DEFAULT_P4_EDITOR_PROMPT;

export const DEFAULT_P1_1_PROMPT = `너는 아폴론이머시브웍스의 트렌드 큐레이터야.

아래는 이번 주 팀 채팅방 대화 전체야.
팀원이 공유한 링크와 루나(AI)의 분석 내용을 함께 읽고, 아티클 후보 목록을 JSON 배열로 만들어줘.

[추출 기준]
- 위클리 후보(is_pinned: true)를 최우선으로 포함
- 링크가 있는 메시지 중 아폴론 사업(미디어 아키텍처, 인터랙티브 설치, 몰입형 경험, 브랜드 공간)과 관련된 것만 선별
- 루나의 분석 내용을 summary로 활용
- 인스타그램/페이스북처럼 분석 불가한 링크는 팀원 메모나 텍스트 기반으로 요약
- 중복 URL 제거
- 최대 20개

[출력 형식]
다른 설명 없이 JSON 배열만 응답해:
[
  {
    "title": "아티클 제목",
    "url": "https://...",
    "summary": "루나 분석 또는 팀원 메모 기반 요약 2-3문장",
    "is_pinned": true/false
  }
]`;

export type ResearchPromptKey =
  | typeof P1_LUNA_PROMPT_KEY
  | typeof P2_TREND_PROMPT_KEY
  | typeof P3_COLLECT_PROMPT_KEY
  | typeof P4_EDITOR_PROMPT_KEY
  | typeof P1_1_ARTICLE_PROMPT_KEY;

export const RESEARCH_PROMPT_KEYS: ResearchPromptKey[] = [
  P1_LUNA_PROMPT_KEY,
  P2_TREND_PROMPT_KEY,
  P3_COLLECT_PROMPT_KEY,
  P4_EDITOR_PROMPT_KEY,
  P1_1_ARTICLE_PROMPT_KEY
];

export function isResearchPromptKey(value: string): value is ResearchPromptKey {
  return (RESEARCH_PROMPT_KEYS as string[]).includes(value);
}

export function resolvePromptStorageKey(key: ResearchPromptKey): string {
  return key;
}

export function getDefaultPromptValue(key: ResearchPromptKey): string {
  switch (key) {
    case P1_LUNA_PROMPT_KEY:
      return DEFAULT_P1_LUNA_PROMPT;
    case P2_TREND_PROMPT_KEY:
      return DEFAULT_P2_TREND_PROMPT;
    case P3_COLLECT_PROMPT_KEY:
      return DEFAULT_P3_COLLECT_PROMPT;
    case P4_EDITOR_PROMPT_KEY:
      return DEFAULT_P4_EDITOR_PROMPT;
    case P1_1_ARTICLE_PROMPT_KEY:
      return DEFAULT_P1_1_PROMPT;
    default:
      return "";
  }
}

export type ResearchPromptsResponse = Record<ResearchPromptKey, string>;

const STORAGE_KEYS = [
  P1_LUNA_PROMPT_KEY,
  LEGACY_LUNA_SYSTEM_PROMPT_KEY,
  P2_TREND_PROMPT_KEY,
  LEGACY_CHAT_SELECTION_PROMPT_KEY,
  P3_COLLECT_PROMPT_KEY,
  LEGACY_COMMON_GPT_PROMPT_KEY,
  LEGACY_GPT_CURATOR_PROMPT_KEY,
  P4_EDITOR_PROMPT_KEY,
  LEGACY_EDITOR_PROMPT_KEY,
  P1_1_ARTICLE_PROMPT_KEY
] as const;

function pickFirst(byKey: Map<string, string>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = byKey.get(key)?.trim();
    if (value) return value;
  }
  return fallback;
}

export async function resolveResearchPrompts(admin: SupabaseClient): Promise<ResearchPromptsResponse> {
  const { data, error } = await admin
    .from("trend_settings")
    .select("key, value")
    .in("key", [...STORAGE_KEYS]);

  if (error) {
    console.error("[prompt-settings] fetch failed", error);
  }

  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));

  return {
    [P1_LUNA_PROMPT_KEY]: pickFirst(
      byKey,
      [P1_LUNA_PROMPT_KEY, LEGACY_LUNA_SYSTEM_PROMPT_KEY],
      DEFAULT_P1_LUNA_PROMPT
    ),
    [P2_TREND_PROMPT_KEY]: pickFirst(
      byKey,
      [P2_TREND_PROMPT_KEY, LEGACY_CHAT_SELECTION_PROMPT_KEY],
      DEFAULT_P2_TREND_PROMPT
    ),
    [P3_COLLECT_PROMPT_KEY]: pickFirst(
      byKey,
      [P3_COLLECT_PROMPT_KEY, LEGACY_COMMON_GPT_PROMPT_KEY, LEGACY_GPT_CURATOR_PROMPT_KEY],
      DEFAULT_P3_COLLECT_PROMPT
    ),
    [P4_EDITOR_PROMPT_KEY]: pickFirst(
      byKey,
      [P4_EDITOR_PROMPT_KEY, LEGACY_EDITOR_PROMPT_KEY],
      DEFAULT_P4_EDITOR_PROMPT
    ),
    [P1_1_ARTICLE_PROMPT_KEY]: pickFirst(
      byKey,
      [P1_1_ARTICLE_PROMPT_KEY],
      DEFAULT_P1_1_PROMPT
    )
  };
}

export { fetchCommonGptPromptSetting, resolveCommonGptPrompt };
