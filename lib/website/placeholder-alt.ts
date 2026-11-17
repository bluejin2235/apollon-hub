/** 의미 없는 대체 텍스트인지. 공개 점검에서 빈칸과 같이 막는다. */

const BANNED_EXACT = new Set([
  "임시",
  "이미지",
  "사진",
  "그림",
  "대체텍스트",
  "대체 텍스트",
  "없음",
  "미정",
  "image",
  "img",
  "photo",
  "picture",
  "alt",
  "tbd",
  "todo",
  "placeholder",
  "untitled",
  "test",
  "테스트"
]);

/** 숫자·문장 부호·기호·공백만 */
const ONLY_NUM_OR_SYMBOL = /^[\p{N}\p{P}\p{S}\s]+$/u;

/** 카메라·메신저·화면 캡처 파일 이름 */
const CAMERA_OR_CHAT_NAME =
  /^(IMG_\d+|DSC\d+|KakaoTalk_|스크린샷)/iu;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

const HANGUL = /[\uAC00-\uD7A3]/;

function looksLikeFilename(value: string): boolean {
  if (IMAGE_EXT.test(value)) return true;
  if (CAMERA_OR_CHAT_NAME.test(value)) return true;
  return false;
}

export function isPlaceholderAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value) return true;
  if (ONLY_NUM_OR_SYMBOL.test(value)) return true;
  if ([...value].length === 1) return true;
  if (BANNED_EXACT.has(value.toLowerCase())) return true;
  if (looksLikeFilename(value)) return true;
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
