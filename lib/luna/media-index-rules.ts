/**
 * 이미지 색인 포함·제외 규칙.
 * Hub 설정 화면으로 옮길 예정 — 코드에 박지 않고 여기서만 관리한다.
 */

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "tif",
  "psd",
  "ai"
]);

/** 100KB 미만 제외 */
export const MIN_FILE_BYTES = 100 * 1024;

/** 이 경로 하위는 규칙 없이 전부 포함 */
export const FULL_INCLUDE_PATH_PREFIXES = [
  "99 Apollog\\01 Trend & Insight"
] as const;

/** 폴더 경로(대소문자 무시)에 하나라도 있으면 포함 후보 */
export const INCLUDE_FOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "reference",
    re: /reference|references|\bref\b|ref\s*image|참고|레퍼런스/i
  },
  { id: "ideation", re: /ideation|아이데이션/i },
  { id: "research", re: /research|리서치|경쟁사\s*분석/i },
  {
    id: "kv_source",
    re: /\bkv\b|\bsource\b|소스|콘티|아트웍|\bart\b|시뮬레이션/i
  }
];

/** 포함보다 우선 — 매칭 시 제외 (id = dry-run 통계용) */
export const EXCLUDE_FOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "render", re: /\brender\b|c4d\s*render|_seq/i },
  { id: "asset_thumb", re: /asset\\SceneImage|asset\\thumbnailimage/i },
  { id: "capture", re: /화면\s*캡(?:쳐|처)|\bcapture\b/i },
  {
    id: "raw_photo",
    re: /미보정|촬영본|촬영\s*사진|사진\s*촬영본|촬영\s*소스|\bDCIM\b|보정\s*컷/i
  },
  { id: "source_bundle", re: /개별\s*소스|소스\s*취합/i },
  { id: "webdesign_lecture", re: /webdesign\s*psd|강의\s*자료/i },
  { id: "provided_88", re: /88\s*제공\s*받은\s*자료/i },
  { id: "recycle_d5", re: /#recycle|_d5c/i },
  { id: "3d_misc", re: /\bSKP\b|\benskape\b|\btexture\b|재질/i },
  { id: "temp", re: /\\temp\\|\\tmp\\|\btemp\b|\btmp\b/i }
];

/** 시범 — T:\\02 Project\\2026 아래 3개 프로젝트 */
export const PILOT_PROJECT_FOLDERS = [
  "260129 삼성디스플레이 시어터룸",
  "260713 더후 글로벌 론칭",
  "260723 아크메르동탄 모델하우스"
] as const;

export const DEFAULT_PILOT_ROOT = "T:\\02 Project\\2026";

export const THUMB_BUCKET = "luna-media-thumbs";
export const VISION_MAX_PX = 640;
export const THUMB_MAX_PX = 400;
