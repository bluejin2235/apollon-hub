/**
 * 이미지 색인 포함·제외 규칙.
 * Hub 설정 화면으로 옮길 예정 — 코드에 박지 않고 여기서만 관리한다.
 */

/** sharp 가 읽는 래스터만 — psd·ai 는 제외(재시도 금지) */
export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "tif"
]);

/** sharp 가 못 읽는 디자인 원본 — 후보에 넣지 않음 */
export const DESIGN_SKIP_EXTENSIONS = new Set(["psd", "ai"]);

/** 100KB 미만 제외 */
export const MIN_FILE_BYTES = 100 * 1024;

/**
 * 우선순위 ③ 태그용 — 더 이상 「포함 필터」가 아니다.
 * (예전에는 이 폴더만 색인 → work_total 2,533)
 */
export const PRIORITY_FOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
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

/** @deprecated 이름만 유지 — PRIORITY_FOLDER_PATTERNS 와 동일 */
export const INCLUDE_FOLDER_PATTERNS = PRIORITY_FOLDER_PATTERNS;

/** 이 경로 하위는 우선순위를 올린다 (전체 포함과 별개) */
export const FULL_INCLUDE_PATH_PREFIXES = [
  "99 Apollog\\01 Trend & Insight"
] as const;

/** 매칭 시 제외 (id = dry-run 통계용) */
export const EXCLUDE_FOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "recycle_d5", re: /#recycle|_d5c|\$recycle|휴지통|recycle\s*bin/i },
  { id: "old_backup", re: /old_backup|_backup|\\bak\\|백업|\\old\\/i },
  { id: "render", re: /\brender\b|c4d\s*render|_seq|렌더\s*시퀀스/i },
  { id: "asset_thumb", re: /asset\\SceneImage|asset\\thumbnailimage/i },
  { id: "capture", re: /화면\s*캡(?:쳐|처)|\bcapture\b/i },
  {
    id: "raw_photo",
    re: /미보정|촬영본|촬영\s*사진|사진\s*촬영본|촬영\s*소스|\bDCIM\b|보정\s*컷/i
  },
  { id: "source_bundle", re: /개별\s*소스|소스\s*취합/i },
  { id: "webdesign_lecture", re: /webdesign\s*psd|강의\s*자료/i },
  { id: "provided_88", re: /88\s*제공\s*받은\s*자료/i },
  {
    id: "3d_misc",
    re: /\bSKP\b|\benskape\b|enscape|\btexture\b|재질|스케치업|sketchup/i
  },
  { id: "temp", re: /\\temp\\|\\tmp\\|\btemp\b|\btmp\b/i },
  {
    id: "portrait",
    re: /증명\s*사진|얼굴|인물\s*사진|프로필/i
  },
  {
    id: "personal",
    re: /\\개인\\|개인\s*폴더|private\\|\bmy\s*documents\b|\\desktop\\/i
  },
  {
    id: "admin_contract",
    re: /행정|계약서|견적\s*상세|인감|사업자등록|세금계산서|통장사본/i
  }
];

/** 영상 재생 캡처 — 원본 영상확장자_YYYYMMDD_HHMMSS */
export const VIDEO_CAPTURE_FILENAME_RE =
  /\.(mp4|mov|mkv|avi|wmv|m4v|ts)_\d{8}_\d{6}/i;

export const VIDEO_CAPTURE_PREFIX_LEN = 30;
export const VIDEO_CAPTURE_PREFIX_MIN_COUNT = 20;

/** 파일명 복사본·중복 표기 */
export const DUP_FILENAME_RE =
  /복사본|의\s*사본|\bcopy\b|\(.*\scopy\)|-\s*복사|\s*copy\s*\d/i;

/**
 * @deprecated 시범 3프로젝트 — 전체 스캔으로 전환. 호환용으로만 남김.
 */
export const PILOT_PROJECT_FOLDERS = [
  "260129 삼성디스플레이 시어터룸",
  "260713 더후 글로벌 론칭",
  "260723 아크메르동탄 모델하우스"
] as const;

/** 전체 색인 기본 루트 — 프로젝트·사업개발·Apollog (드라이브 전체는 너무 큼) */
export const DEFAULT_SCAN_ROOTS = [
  "T:\\02 Project",
  "T:\\01 사업개발",
  "T:\\99 Apollog"
] as const;
/** 단일 루트 CLI 기본값 */
export const DEFAULT_SCAN_ROOT = "T:\\02 Project";
/** @deprecated 별칭 */
export const DEFAULT_PILOT_ROOT = DEFAULT_SCAN_ROOT;

/** 최근 프로젝트 연도 (우선순위 ②) */
export const RECENT_PROJECT_YEARS = [2024, 2025, 2026] as const;

export const THUMB_BUCKET = "luna-media-thumbs";
/** AI 비전 입력 — Storage 저장 안 함 */
export const VISION_MAX_PX = 800;
/** 그리드 썸네일 Storage */
export const THUMB_MAX_PX = 400;
/** 확대 보기 Storage */
export const LARGE_MAX_PX = 1200;

/** 야간 기본 예산 — 다른 잡(03:00~) 전에 끊김 */
export const DEFAULT_MAX_HOURS = 5.5;
/** 하루 비용 상한 (아르테 누적 $324 가드와 별도) */
export const DEFAULT_MAX_COST_USD = 40;
/** 승인 총 예산 */
export const MEDIA_INDEX_BUDGET_USD = 324;
