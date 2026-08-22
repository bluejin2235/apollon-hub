/**
 * Work서버 경로 → 프로젝트 맥락 해석 (이미지 색인 시범용).
 * 파일명보다 폴더 경로가 정보의 대부분이다.
 */

export type PathActorKind = "internal" | "partner" | "person" | null;

export type MediaPathParts = {
  drive: string;
  rootClass: string | null;
  year: string | null;
  project: string | null;
  stageCode: string | null;
  stageName: string | null;
  actor: string | null;
  actorKind: PathActorKind;
  dateToken: string | null;
  variant: string | null;
  workKind: string | null;
  detail: string | null;
  segments: string[];
  /** 사람이 읽기 좋은 한 줄 */
  summary: string;
};

export type FolderCategory =
  | "exclude"
  | "reference"
  | "provided"
  | "our_design"
  | "field_photo"
  | "field_test"
  | "unclassified";

const ROOT_CLASS_RE =
  /^(01\s*사업개발|02\s*Project|03\s*R&D|03\s*R＆D|07\s*마케팅|99\s*Apollog)/i;

const STAGE_NAME_MAP: Array<{ re: RegExp; code: string; name: string }> = [
  { re: /management|관리|계약|행정/i, code: "00", name: "Management" },
  { re: /document|문서|기획서|제안서/i, code: "01", name: "Document" },
  { re: /ideation|아이데이션/i, code: "02", name: "Ideation" },
  { re: /reference|레퍼런스|참고|사례/i, code: "03", name: "Reference" },
  { re: /design|디자인|아트웍|시안|concept/i, code: "04", name: "Design" },
  { re: /space|공간|도면|현장답사/i, code: "05", name: "Space" },
  { re: /test|테스트|현장\s*테스트/i, code: "06", name: "Test" },
  { re: /홍보|마케팅|포트폴리오|sns|behance|인스타/i, code: "88", name: "홍보마케팅" },
  { re: /제공받은|제공\s*자료/i, code: "99", name: "제공받은자료" }
];

const PARTNER_RE = /래빗워크|rabbit\s*work|ym\s*미디어|ym미디어|와이엠/i;
const INTERNAL_ORG_RE = /아폴론|apollon/i;
const PERSON_INITIAL_RE = /^(TJ|YR|SH|KDH|LHC|JH|MJ|DH|SE|YR)$/i;
const PERSON_HANGUL_RE = /^(세희|다혜|예림|지현|민준|서현|태준)$/;

const VARIANT_RE = /([AB]\s*안|[1-9]\s*차|초안|최종|FIN|final)/i;
const DATE_TOKEN_RE = /\b(2[0-9]{5})\b/;
const YEAR_FOLDER_RE = /^(20[12][0-9])$/;

const EXCLUDE_PATH_RE =
  /#recycle|_d5c|[/\\]render[/\\]|3d\s*asset|화면캡쳐|화면\s*캡처|캡처|00\s*Management/i;

const MEANINGLESS_NAME_RE =
  /^(img[_\-\s]?\d+|dsc[_\-\s]?\d+|screenshot|스크린샷|무제|untitled|image\s*\d*|\d{6,}|\d+\.(?:jpg|jpeg|png))$/i;

export function normalizeWorkPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+/g, "\\").trim();
}

export function splitPathSegments(fullPath: string): string[] {
  const n = normalizeWorkPath(fullPath);
  const withoutDrive = n.replace(/^[A-Za-z]:\\/, "");
  return withoutDrive.split("\\").filter(Boolean);
}

export function isMeaninglessFileName(fileName: string): boolean {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  if (!base) return true;
  if (MEANINGLESS_NAME_RE.test(base)) return true;
  if (/^[\d_\-\s]+$/.test(base)) return true;
  if (base.length <= 2) return true;
  return false;
}

export function shouldExcludePath(fullPath: string): boolean {
  return EXCLUDE_PATH_RE.test(normalizeWorkPath(fullPath));
}

function detectActor(
  segments: string[]
): { actor: string | null; actorKind: PathActorKind } {
  for (const seg of segments) {
    if (PARTNER_RE.test(seg)) {
      return { actor: seg.trim(), actorKind: "partner" };
    }
  }
  for (const seg of segments) {
    if (INTERNAL_ORG_RE.test(seg)) {
      return { actor: "아폴론", actorKind: "internal" };
    }
  }
  for (const seg of segments) {
    const t = seg.trim();
    if (PERSON_INITIAL_RE.test(t) || PERSON_HANGUL_RE.test(t)) {
      return { actor: t, actorKind: "person" };
    }
    // "아폴론\TJ" style mid segment
    const m = t.match(/\b(TJ|YR|SH|KDH|LHC)\b/i);
    if (m) return { actor: m[1]!.toUpperCase(), actorKind: "person" };
  }
  return { actor: null, actorKind: null };
}

function detectStage(
  segments: string[]
): { code: string | null; name: string | null } {
  for (const seg of segments) {
    if (ROOT_CLASS_RE.test(seg)) continue;
    if (YEAR_FOLDER_RE.test(seg)) continue;
    if (/^\d{6}\s+/.test(seg)) continue; // project folder
    const num = seg.match(/^(\d{2})\s+(.+)$/);
    if (num) {
      for (const row of STAGE_NAME_MAP) {
        if (row.re.test(num[2]!)) {
          return { code: num[1]!, name: row.name };
        }
      }
      // numbered but unknown label — still a stage folder
      return { code: num[1]!, name: num[2]!.trim() };
    }
    for (const row of STAGE_NAME_MAP) {
      if (row.re.test(seg)) return { code: row.code, name: row.name };
    }
  }
  return { code: null, name: null };
}

/**
 * 폴더명 규칙 분류. 「레퍼런스」가 홍보 스틸컷일 수 있어 AI와 교차 확인한다.
 */
export function classifyFolderCategory(fullPath: string): FolderCategory {
  const p = normalizeWorkPath(fullPath);
  if (shouldExcludePath(p)) return "exclude";

  // 홍보·포트폴리오 안 레퍼런스는 our marketing still 쪽
  if (
    /홍보|마케팅|behance|인스타|포트폴리오/i.test(p) &&
    /레퍼런스|thumnail|thumbnail|still\s*cut|스틸/i.test(p)
  ) {
    return "field_photo";
  }

  if (/제공받은|[/\\]88\s*제공|고객\s*제공/i.test(p)) return "provided";
  // Design·Ideation 안의 「레퍼런스」는 우리 시안 단계 수집물
  if (
    /[/\\]\d{0,2}\s*Design[/\\]|[/\\]\d{0,2}\s*Ideation[/\\]|아이데이션|아트웍|시안|concept/i.test(
      p
    )
  ) {
    return "our_design";
  }
  if (/reference|레퍼런스|참고\s*자료|사례\s*수집/i.test(p)) return "reference";
  if (
    /design|ideation|아이데이션|제안|시안|concept|아트웍|구도\s*테스트/i.test(p)
  ) {
    return "our_design";
  }
  if (/test|현장\s*테스트|현장답사|공간사진|시뮬레이션/i.test(p)) {
    return "field_test";
  }
  if (/촬영|준공|마케팅|홍보|behance|인스타/i.test(p)) return "field_photo";
  return "unclassified";
}

export function parseMediaPath(fullPath: string): MediaPathParts {
  const n = normalizeWorkPath(fullPath);
  const drive = (n.match(/^([A-Za-z]):/)?.[1] ?? "T").toUpperCase();
  const segments = splitPathSegments(n);
  // drop filename
  const dirs = segments.slice(0, -1);

  let rootClass: string | null = null;
  let year: string | null = null;
  let project: string | null = null;

  for (let i = 0; i < dirs.length; i++) {
    const seg = dirs[i]!;
    if (!rootClass && ROOT_CLASS_RE.test(seg)) {
      rootClass = seg;
      continue;
    }
    if (!year && YEAR_FOLDER_RE.test(seg)) {
      year = seg;
      continue;
    }
    // project folder often YYMMDD name…
    if (!project && year && /^\d{6}\s+/.test(seg)) {
      project = seg;
      continue;
    }
    if (!project && rootClass && !YEAR_FOLDER_RE.test(seg) && !/^\d{2}\s+/.test(seg)) {
      // after root, before numbered stage
      if (!year && /20[12]\d/.test(seg)) {
        // embedded year in project name
      }
    }
  }

  // fallback project: first YYMMDD folder under year/root
  if (!project) {
    for (const seg of dirs) {
      if (/^\d{6}\s+\S/.test(seg)) {
        project = seg;
        break;
      }
    }
  }

  const { code: stageCode, name: stageName } = detectStage(dirs);
  const { actor, actorKind } = detectActor(dirs);

  let dateToken: string | null = null;
  let variant: string | null = null;
  let workKind: string | null = null;
  for (const seg of dirs) {
    const d = seg.match(DATE_TOKEN_RE);
    if (d) dateToken = d[1]!;
    const v = seg.match(VARIANT_RE);
    if (v) variant = v[1]!.replace(/\s+/g, "");
    if (
      /레퍼런스|구도|아트웍|목업|mockup|시뮬레이션|BTS|breakdown|썸네일|still/i.test(
        seg
      )
    ) {
      workKind = seg;
    }
  }

  const detail = dirs.length >= 2 ? dirs.slice(-2).join(" › ") : dirs[0] ?? null;

  const bits = [
    rootClass,
    year,
    project,
    stageName ? `${stageCode ?? ""} ${stageName}`.trim() : null,
    actor,
    dateToken,
    variant,
    workKind
  ].filter(Boolean);

  return {
    drive,
    rootClass,
    year,
    project,
    stageCode,
    stageName,
    actor,
    actorKind,
    dateToken,
    variant,
    workKind,
    detail,
    segments: dirs,
    summary: bits.join(" · ")
  };
}

export function pathParseSuccessFlags(parts: MediaPathParts): {
  hasStage: boolean;
  hasActor: boolean;
  hasVariantOrDate: boolean;
} {
  return {
    hasStage: Boolean(parts.stageName || parts.stageCode),
    hasActor: Boolean(parts.actor),
    hasVariantOrDate: Boolean(parts.variant || parts.dateToken)
  };
}

export const GLOSSARY_VISUAL_NEEDLES = [
  "미디어",
  "LED",
  "파사드",
  "조형",
  "스크린",
  "프로젝션",
  "인터랙",
  "아나몰",
  "커브",
  "픽셀",
  "공개공지",
  "사이니지",
  "디스플레이",
  "맵핑",
  "홀로",
  "키네틱",
  "조명",
  "영상",
  "전시",
  "이머시브",
  "몰입"
] as const;
