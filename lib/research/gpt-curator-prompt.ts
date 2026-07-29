import type { SupabaseClient } from "@supabase/supabase-js";

export const P3_COLLECT_PROMPT_KEY = "p3_collect_prompt";

/** @deprecated `p3_collect_prompt` 이전 키 */
export const LEGACY_COMMON_GPT_PROMPT_KEY = "common_gpt_prompt";

/** @deprecated `p3_collect_prompt` 이전 키 */
export const LEGACY_GPT_CURATOR_PROMPT_KEY = "gpt_curator_prompt";

/** @deprecated `P3_COLLECT_PROMPT_KEY` 사용 */
export const COMMON_GPT_PROMPT_KEY = P3_COLLECT_PROMPT_KEY;

/** @deprecated `P3_COLLECT_PROMPT_KEY` 사용 */
export const GPT_CURATOR_PROMPT_KEY = P3_COLLECT_PROMPT_KEY;

export const DEFAULT_P3_COLLECT_PROMPT = `너는 아폴론이머시브웍스의 트렌드 큐레이터야.
아폴론은 공간과 디지털을 결합한 몰입형 경험을 만드는 미디어 아키텍처 스튜디오야.
주요 작업: 리테일/전시/공공공간의 디지털 랜드마크화, 미디어파사드, 인터랙티브 설치, 브랜드 공간 경험 설계.
반드시 JSON 배열만 응답해. 다른 텍스트 없이.

아래 기사 중 아폴론이 참고할 만한 기사 인덱스를 JSON 배열로만 응답해.
포함할 것:
- 미디어 아키텍처, 미디어파사드, 프로젝션 매핑
- 인터랙티브 설치, 몰입형 경험 (immersive experience)
- 전시 공간, 뮤지엄 디자인, 팝업 공간
- 리테일 경험 디자인, 플래그십 스토어
- 공공공간 디지털 설치, 랜드마크
- AI/기술을 활용한 공간/경험 디자인
제외할 것:
- 패션, 뷰티, 식품, 자동차, 스포츠
- 단순 인테리어/건축 (디지털/기술 요소 없는 것)
- 회화, 조각 등 전통 미술 (공간 경험과 무관한 것)
응답 예시: [0, 2, 5, 8]
기사 없으면: []`;

/** @deprecated `DEFAULT_P3_COLLECT_PROMPT` 사용 */
export const DEFAULT_COMMON_GPT_PROMPT = DEFAULT_P3_COLLECT_PROMPT;

/** @deprecated `DEFAULT_P3_COLLECT_PROMPT` 사용 */
export const DEFAULT_GPT_CURATOR_PROMPT = DEFAULT_P3_COLLECT_PROMPT;

export type TrendSetting = {
  key: string;
  value: string;
  updated_at: string;
};

const P3_LEGACY_KEYS = [
  P3_COLLECT_PROMPT_KEY,
  LEGACY_COMMON_GPT_PROMPT_KEY,
  LEGACY_GPT_CURATOR_PROMPT_KEY
] as const;

/** trend_settings 조회 시 우선순위 (신규 → 레거시) */
export const P3_COLLECT_PROMPT_READ_KEYS = P3_LEGACY_KEYS;

function pickCollectPromptFromRows(
  byKey: Map<string, string>,
  sourcePrompt?: string | null
): string {
  const fromSource = sourcePrompt?.trim();
  if (fromSource) return fromSource;

  for (const key of P3_LEGACY_KEYS) {
    const value = byKey.get(key)?.trim();
    if (value) return value;
  }

  return DEFAULT_P3_COLLECT_PROMPT;
}

/** 수집 소스 개별 프롬프트 → 공통(trend_settings) → 기본값 순으로 resolve */
export async function resolveCommonGptPrompt(
  admin: SupabaseClient,
  sourcePrompt?: string | null
): Promise<string> {
  if (sourcePrompt?.trim()) {
    return sourcePrompt.trim();
  }

  const { data, error } = await admin
    .from("trend_settings")
    .select("key, value")
    .in("key", [...P3_LEGACY_KEYS]);

  if (error) {
    console.error("[collect-prompt] fetch failed", error);
    return DEFAULT_P3_COLLECT_PROMPT;
  }

  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));
  return pickCollectPromptFromRows(byKey);
}

export async function fetchCommonGptPromptSetting(admin: SupabaseClient): Promise<string> {
  return resolveCommonGptPrompt(admin);
}
