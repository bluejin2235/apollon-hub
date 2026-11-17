/** 의미 없는 대체 텍스트인지. 공개 점검에서 빈칸과 같이 막는다. */

const BANNED_EXACT = new Set([
  "임시",
  "test",
  "테스트",
  "tbd",
  "todo",
  "alt",
  "image",
  "이미지",
  "사진"
]);

/** 숫자·문장 부호·기호·공백만 */
const ONLY_NUM_OR_SYMBOL = /^[\p{N}\p{P}\p{S}\s]+$/u;

const HANGUL = /[\uAC00-\uD7A3]/;

export function isPlaceholderAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value) return true;
  if (ONLY_NUM_OR_SYMBOL.test(value)) return true;
  if ([...value].length <= 3) return true;
  if (BANNED_EXACT.has(value.toLowerCase())) return true;
  return false;
}

/** 영문 칸에 한글이 섞였는지 */
export function hasHangulInText(text: string | null | undefined): boolean {
  return HANGUL.test((text ?? "").trim());
}

/**
 * 영문 대체 텍스트 경고 대상.
 * 임시값·빈칸이거나 한글이 들어가면 참. 공개는 막지 않는다.
 */
export function isWeakEnglishAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (isPlaceholderAlt(value)) return true;
  return hasHangulInText(value);
}
