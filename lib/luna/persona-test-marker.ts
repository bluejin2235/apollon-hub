/** 9×15 개인화 점검 표시 — 대화 제목·베타 note·설정 키에 쓴다. */
export const PERSONA_TEST_PREFIX = "[P9TEST:";

export function personaTestTitle(runId: string, part: number): string {
  return `${PERSONA_TEST_PREFIX}${runId}] 개인화점검 ${part}/3`;
}

export function isPersonaTestTitle(title: unknown): boolean {
  return typeof title === "string" && title.startsWith(PERSONA_TEST_PREFIX);
}

export function parsePersonaTestRunId(title: string): string | null {
  if (!isPersonaTestTitle(title)) return null;
  const m = title.match(/^\[P9TEST:([^\]]+)\]/);
  return m?.[1] ?? null;
}

export const PERSONA_TEST_SETTINGS_KEY = "persona_9x15_runs";
export const PERSONA_TEST_BETA_NOTE_PREFIX = "P9TEST:";
