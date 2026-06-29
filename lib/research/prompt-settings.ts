import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_GPT_CURATOR_PROMPT,
  GPT_CURATOR_PROMPT_KEY
} from "@/lib/research/gpt-curator-prompt";
import {
  DEFAULT_LUNA_SYSTEM_PROMPT,
  LUNA_SYSTEM_PROMPT_KEY
} from "@/lib/research/luna-system-prompt";

export const CHAT_SELECTION_PROMPT_KEY = "chat_selection_prompt";
export const EDITOR_PROMPT_KEY = "editor_prompt";
/** UI/API key — DB에는 `gpt_curator_prompt`로 저장 (기존 데이터 호환) */
export const COMMON_GPT_PROMPT_KEY = "common_gpt_prompt";

export const DEFAULT_CHAT_SELECTION_PROMPT =
  "아폴론이머시브웍스 팀원들의 채팅방 대화를 분석해서 아폴론의 사업 방향(미디어 아키텍처, 인터랙티브 설치, 몰입형 경험, 브랜드 공간)과 관련된 핵심 아젠다와 키워드를 추출해줘. 위클리 후보로 마킹된 것을 우선으로 하고, 반복 언급된 주제를 중심으로 최대 15개 아젠다를 뽑아줘.";

export const DEFAULT_EDITOR_PROMPT =
  "너는 아폴론이머시브웍스의 AI 편집장이야. 아폴론은 미디어 아키텍처 전문 스튜디오로 We Make Beloved Digital Landmarks가 미션이야. 채팅방 아젠다와 수집사이트 아티클 전체 후보 중에서 아폴론이 실제로 참고하고 영감받을 만한 것 최대 15개를 선정해줘. 선정 기준: 아폴론 프로젝트와 직접 연관성, 새로운 기술/공간 경험 트렌드, 클라이언트 제안서 활용 가능성.";

export type ResearchPromptKey =
  | typeof LUNA_SYSTEM_PROMPT_KEY
  | typeof COMMON_GPT_PROMPT_KEY
  | typeof CHAT_SELECTION_PROMPT_KEY
  | typeof EDITOR_PROMPT_KEY;

export const RESEARCH_PROMPT_KEYS: ResearchPromptKey[] = [
  LUNA_SYSTEM_PROMPT_KEY,
  COMMON_GPT_PROMPT_KEY,
  CHAT_SELECTION_PROMPT_KEY,
  EDITOR_PROMPT_KEY
];

export function isResearchPromptKey(value: string): value is ResearchPromptKey {
  return (RESEARCH_PROMPT_KEYS as string[]).includes(value);
}

/** trend_settings 실제 저장 키 */
export function resolvePromptStorageKey(key: ResearchPromptKey): string {
  if (key === COMMON_GPT_PROMPT_KEY) {
    return GPT_CURATOR_PROMPT_KEY;
  }
  return key;
}

export function getDefaultPromptValue(key: ResearchPromptKey): string {
  switch (key) {
    case LUNA_SYSTEM_PROMPT_KEY:
      return DEFAULT_LUNA_SYSTEM_PROMPT;
    case COMMON_GPT_PROMPT_KEY:
      return DEFAULT_GPT_CURATOR_PROMPT;
    case CHAT_SELECTION_PROMPT_KEY:
      return DEFAULT_CHAT_SELECTION_PROMPT;
    case EDITOR_PROMPT_KEY:
      return DEFAULT_EDITOR_PROMPT;
    default:
      return "";
  }
}

export type ResearchPromptsResponse = Record<ResearchPromptKey, string>;

const STORAGE_KEYS = [
  LUNA_SYSTEM_PROMPT_KEY,
  GPT_CURATOR_PROMPT_KEY,
  CHAT_SELECTION_PROMPT_KEY,
  EDITOR_PROMPT_KEY
] as const;

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
    [LUNA_SYSTEM_PROMPT_KEY]:
      byKey.get(LUNA_SYSTEM_PROMPT_KEY)?.trim() || DEFAULT_LUNA_SYSTEM_PROMPT,
    [COMMON_GPT_PROMPT_KEY]:
      byKey.get(GPT_CURATOR_PROMPT_KEY)?.trim() || DEFAULT_GPT_CURATOR_PROMPT,
    [CHAT_SELECTION_PROMPT_KEY]:
      byKey.get(CHAT_SELECTION_PROMPT_KEY)?.trim() || DEFAULT_CHAT_SELECTION_PROMPT,
    [EDITOR_PROMPT_KEY]: byKey.get(EDITOR_PROMPT_KEY)?.trim() || DEFAULT_EDITOR_PROMPT
  };
}
