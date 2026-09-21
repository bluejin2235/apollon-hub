/**
 * 이미지 색인 포함·제외 규칙.
 * Hub 설정 화면으로 옮길 예정 — 코드에 박지 않고 여기서만 관리한다.
 *
 * 판정 순서 (media-scan):
 *   1) 확장자·크기
 *   2) KEEP(예외) — 현장답사·레퍼런스·아이데이션 등 → 아래 제외를 건너뜀
 *   3) 경로·파일명 제외
 *   4) 폴더 내 연속(20장+) 제외
 *
 * 전체 색인·매일 증분이 이 파일만 본다.
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

/** 폴더 내 같은 접두사·연속 패턴 최소 장수 */
export const SEQUENCE_MIN_COUNT = 20;

/**
 * KEEP — 「연속·촬영원본 덤프」제외만 건너뜀.
 * 프로그램 캐시·영상 프레임·3D 에셋 폴더는 KEEP이어도 제외 (하드).
 * 현장답사·레퍼런스·아이데이션의 해시/Behance·일반 연속은 남긴다.
 */
export const KEEP_PATH_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "field_survey", re: /현장\s*답사|(?:^|[\\/\s])답사(?:[\\/\s]|$)/i },
  {
    id: "reference",
    re: /reference|references|\bref\b|ref\s*image|참고|레퍼런스|\\refs?\\/i
  },
  { id: "ideation", re: /ideation|아이데이션/i },
  {
    id: "design_output",
    re: /\bkv\b|시안|준공|디자인\s*산출/i
  }
];

/** KEEP이어도 적용하는 경로 제외 (하드) */
export const HARD_EXCLUDE_FOLDER_IDS = new Set([
  "recycle_d5",
  "d5_cache",
  "collab_work",
  "animatic",
  "client_3d",
  "promo_ref_photos",
  "design_source_stock",
  "material_stock",
  "old_backup",
  "render",
  "capture",
  "raw_photo",
  "temp"
]);

/** KEEP이어도 적용하는 파일명 제외 (하드) */
export const HARD_EXCLUDE_FILENAME_IDS = new Set([
  "weightmap",
  "white_texture",
  "enscape_auto",
  "frame_zeros",
  "still_seq",
  "auto_frame",
  "video_ext_frame",
  "render_layer"
]);

/**
 * 우선순위 ③ 태그용 — 포함 필터가 아님.
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

/**
 * 경로 제외 (패턴). KEEP 이면 적용하지 않음.
 * id = dry-run 통계용.
 */
export const EXCLUDE_FOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "recycle_d5", re: /#recycle|_d5c|\$recycle|휴지통|recycle\s*bin/i },
  { id: "d5_cache", re: /\\D5\\/i },
  { id: "collab_work", re: /\\공동작업\\/i },
  {
    id: "animatic",
    re: /애니메틱|애니매틱|animatic/i
  },
  {
    id: "client_3d",
    re: /고객사\s*수취|Expert\s*Image/i
  },
  {
    id: "promo_ref_photos",
    re: /홍보마케팅\\[^\\]*\\[^\\]*레퍼런스\s*사진|\\레퍼런스\s*사진\\|\\Reference\s*Image\\/i
  },
  {
    id: "design_source_stock",
    // 폴더 노드 자체에는 끝 \ 가 없다 — ($|\\) 로 잡는다
    re: /(^|\\)04\s*Design\s*source($|\\)/i
  },
  {
    id: "material_stock",
    // 「재질」·「00 재질」 둘 다. 끝 \ 없어도 폴더 노드에서 맞음
    re: /(^|\\)(?:\d+\s*)?재질($|\\)/
  },
  {
    id: "old_backup",
    re: /old_backup|_backup|\\bak\\|백업|(^|\\)_old($|\\)|(^|\\)old($|\\)/i
  },
  { id: "render", re: /\brender\b|c4d\s*render|_seq|렌더\s*시퀀스/i },
  { id: "asset_thumb", re: /asset\\SceneImage|asset\\thumbnailimage/i },
  { id: "capture", re: /화면\s*캡(?:쳐|처)|\bcapture\b/i },
  {
    id: "raw_photo",
    re: /미보정|보정\s*전|보정전|촬영본|촬영\s*사진|사진\s*촬영본|촬영\s*소스|\bDCIM\b|보정\s*컷/i
  },
  { id: "source_bundle", re: /개별\s*소스|소스\s*취합/i },
  { id: "webdesign_lecture", re: /webdesign\s*psd|강의\s*자료/i },
  { id: "provided_88", re: /88\s*제공\s*받은\s*자료/i },
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

/**
 * 폴더 세그먼트가 model / textures / map / material 로 끝나면 제외.
 * 「251205 model」처럼 접미사도 포함.
 */
export function folderSegmentIs3dAsset(seg: string): boolean {
  const s = seg.trim();
  if (!s) return false;
  if (/_files$/i.test(s)) return false; // 별도 규칙
  return (
    /^(models?|textures?|maps?|materials?|재질)$/i.test(s) ||
    /[\s_\-](models?|textures?|maps?|materials?|재질)$/i.test(s)
  );
}

export function folderSegmentIsWebFiles(seg: string): boolean {
  return /_files$/i.test(seg.trim());
}

/** 경로에 3d asset / _files 폴더 세그먼트가 있으면 id 반환 */
export function matchAssetFolderExclude(
  relativePath: string
): "asset_folder" | "web_files" | null {
  const parts = relativePath.replace(/\//g, "\\").split("\\");
  for (const seg of parts) {
    if (folderSegmentIsWebFiles(seg)) return "web_files";
    if (folderSegmentIs3dAsset(seg)) return "asset_folder";
  }
  return null;
}

/** 파일명 제외 (KEEP 이면 적용 안 함) */
export const EXCLUDE_FILENAME_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "weightmap", re: /^WeightMap_/i },
  { id: "white_texture", re: /white_texture/i },
  { id: "enscape_auto", re: /^Enscape_/i },
  { id: "frame_zeros", re: /_\d{5}(\.[^.]+)?$/i },
  { id: "still_seq", re: /Still_\d{4}/i },
  { id: "auto_frame", re: /_auto_\d+_\d+/i },
  { id: "video_ext_frame", re: /\.(mp4|mov)_/i },
  {
    id: "render_layer",
    re: /_(?:AO|Normal|MaterialID|Albedo)(?:\.[^.]+)?$/i
  }
];

/** 영상 재생 캡처 — 원본 영상확장자_YYYYMMDD_HHMMSS */
export const VIDEO_CAPTURE_FILENAME_RE =
  /\.(mp4|mov|mkv|avi|wmv|m4v|ts)_\d{8}_\d{6}/i;

export const VIDEO_CAPTURE_PREFIX_LEN = 30;
export const VIDEO_CAPTURE_PREFIX_MIN_COUNT = SEQUENCE_MIN_COUNT;

/** 파일명 복사본·중복 표기 */
export const DUP_FILENAME_RE =
  /복사본|의\s*사본|\bcopy\b|\(.*\scopy\)|-\s*복사|\s*copy\s*\d/i;

/** 촬영 원본 연속 — 경로에 \원본\ + 아래 접두사 */
export const CAMERA_ORIGIN_PATH_RE = /\\원본\\/i;
export const CAMERA_FILENAME_RE =
  /^(DSC_?|_JW_|_MG_|IMG_?|DSC)\d*/i;

/**
 * @deprecated 시범 3프로젝트 — 전체 스캔으로 전환. 호환용으로만 남김.
 */
export const PILOT_PROJECT_FOLDERS = [
  "260129 삼성디스플레이 시어터룸",
  "260713 더후 글로벌 론칭",
  "260723 아크메르동탄 모델하우스"
] as const;

/** 전체 색인 기본 루트 — 프로젝트·사업개발·Apollog */
export const DEFAULT_SCAN_ROOTS = [
  "T:\\02 Project",
  "T:\\01 사업개발",
  "T:\\99 Apollog"
] as const;
export const DEFAULT_SCAN_ROOT = "T:\\02 Project";
/** @deprecated 별칭 */
export const DEFAULT_PILOT_ROOT = DEFAULT_SCAN_ROOT;

/** 최근 프로젝트 연도 (우선순위 ②) */
export const RECENT_PROJECT_YEARS = [2024, 2025, 2026] as const;

export const THUMB_BUCKET = "luna-media-thumbs";
export const VISION_MAX_PX = 800;
export const THUMB_MAX_PX = 400;
export const LARGE_MAX_PX = 1200;

/** 내일부터 하루 작업 시간. 일요일 킥오프는 CLI 로 더 길게 */
export const DEFAULT_MAX_HOURS = 8;
/** 하루 비용 상한 */
export const DEFAULT_MAX_COST_USD = 450;
/** 총 예산 하드스톱 — 넘으면 멈추고 보고 */
export const MEDIA_INDEX_BUDGET_USD = 450;
/** 예상(보고용) — A안 75,695장 */
export const MEDIA_INDEX_EXPECTED_USD = 431;
/** 새 덩어리 알림 — 폴더당 이 장수 이상 */
export const NEW_CHUNK_FOLDER_MIN = 200;

/**
 * 03:00~08:00 KST.
 * 03:00~05:30 다른 배치, 05:00 모드 A(약 1시간 40분~실측 07:48)와 겹치지 않음.
 */
export const BATCH_QUIET_START_MIN = 3 * 60;
export const BATCH_QUIET_END_MIN = 8 * 60;
