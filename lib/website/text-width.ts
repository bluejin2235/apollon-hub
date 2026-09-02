/**
 * 목록 카드·제목 칸 — 표시 폭.
 * 한글·한자·가나 한 글자당 2, 그 밖은 1.
 */

function isDoubleWidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // 한글 자모
    (cp >= 0x3040 && cp <= 0x309f) || // 히라가나
    (cp >= 0x30a0 && cp <= 0x30ff) || // 가타카나
    (cp >= 0x3130 && cp <= 0x318f) || // 한글 호환 자모
    (cp >= 0x3400 && cp <= 0x4dbf) || // 한자 확장 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // 한자
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xf900 && cp <= 0xfaff) // 한자 호환
  );
}

/** 문자열 표시 폭 */
export function textWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    width += isDoubleWidth(cp) ? 2 : 1;
  }
  return width;
}

/** 워크 제목 — 국문 칸 22자×2, 영문 칸 46 */
export const WORK_TITLE_KO_MAX = 44;
export const WORK_TITLE_EN_MAX = 46;
export const WORK_TITLE_KO_RECOMMEND = 22;
export const WORK_TITLE_EN_RECOMMEND = 23;

/** 인사이트 제목 — 국문 칸 30자×2, 영문 칸 60 */
export const INSIGHT_TITLE_KO_MAX = 60;
export const INSIGHT_TITLE_EN_MAX = 60;

export function withinTextWidth(value: string, max: number): boolean {
  const text = value.trim();
  return text.length > 0 && textWidth(text) <= max;
}

export function overTextWidth(value: string, max: number): boolean {
  return textWidth(value) > max;
}
