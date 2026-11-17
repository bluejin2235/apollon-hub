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

/**
 * 임시 낱말로 시작하고 뒤에 「용·값」, 이미지 낱말, 번호만 붙은 꼴.
 * 예: 「임시 이미지」「테스트용」「test image 2」「샘플 사진」.
 * 「테스트하는 팀원들」「임시로 쓴 설명이 아닙니다」처럼 문장이 이어지면 통과.
 */
const TEMP_WORD_ONLY =
  /^(임시|테스트|샘플|더미|미정|test|tmp|temp|dummy|sample|placeholder|tbd|todo)(용|값)?([\s_\-.]*(이미지|사진|그림|파일|image|img|photo|picture|pic|file))?([\s_\-.]*\d+)?$/iu;

/** 「image 1」「img_03」「photo-2」「사진1」「이미지 3」 */
const IMAGE_WORD_NUMBER =
  /^(image|img|photo|picture|pic|사진|이미지|그림)[\s_\-.]*\d+$/iu;

function looksLikeFilename(value: string): boolean {
  if (IMAGE_EXT.test(value)) return true;
  if (CAMERA_OR_CHAT_NAME.test(value)) return true;
  if (IMAGE_WORD_NUMBER.test(value)) return true;
  return false;
}

/**
 * 공개를 막는 임시값: 빈칸 · 숫자·기호만 · 임시 낱말 · 파일 이름 꼴.
 * 한 글자는 「꽃」「숲」처럼 정상 설명일 수 있어 막지 않고 isShortAlt 로 경고만 한다.
 */
export function isPlaceholderAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value) return true;
  if (ONLY_NUM_OR_SYMBOL.test(value)) return true;
  if (BANNED_EXACT.has(value.toLowerCase())) return true;
  if (TEMP_WORD_ONLY.test(value)) return true;
  if (looksLikeFilename(value)) return true;
  return false;
}

/** 한 글자 대체 텍스트 — 공개는 막지 않고 경고만 */
export function isShortAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (isPlaceholderAlt(value)) return false;
  return [...value].length === 1;
}

/** 영문 칸에 한글이 섞였는지 */
export function hasHangulInText(text: string | null | undefined): boolean {
  return HANGUL.test((text ?? "").trim());
}

/**
 * 영문 대체 텍스트 경고 대상.
 * 임시값·빈칸·한 글자이거나 한글이 들어가면 참. 공개는 막지 않는다.
 */
export function isWeakEnglishAlt(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (isPlaceholderAlt(value)) return true;
  if (isShortAlt(value)) return true;
  return hasHangulInText(value);
}
