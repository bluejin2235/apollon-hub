/**
 * 2차 데이터 — 경로·이름 규칙. LLM 없음.
 * pg_trgm 과 같은 3-gram Dice 유사도.
 */
import { LINK_ASK_MIN, LINK_AUTO_SAVE } from "@/lib/luna-admin/confidence";

export { LINK_ASK_MIN, LINK_AUTO_SAVE };
export const LLM_SIM_MIN = 0.45;
export const LLM_SIM_MAX = 0.6;
export const LLM_MAX_CALLS = 500;
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const ROOT_CLASS_RE =
  /^(01\s*사업개발|02\s*Project|03\s*R&D|03\s*R＆D|07\s*마케팅|99\s*Apollog)/i;
const YEAR_FOLDER_RE = /^(20[12][0-9])$/;
const PROJECT_FOLDER_RE = /^(\d{6})\s+(\S.*)$/;

export type WorkFolder = {
  drive: string;
  relativePath: string;
  fullPath: string;
  root: string;
  year: string;
  project: string;
  dateCode: string;
  coreName: string;
  isBd: boolean;
  isDelivery: boolean;
};

export function normalizeWorkPath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+/g, "\\").trim();
}

export function fullNasPath(drive: string, relativePath: string): string {
  const d = (drive || "T").replace(/:$/, "").toUpperCase();
  const rel = normalizeWorkPath(relativePath).replace(/^\\+/, "");
  return `${d}:\\${rel}`;
}

export function splitPathSegments(fullPath: string): string[] {
  const n = normalizeWorkPath(fullPath);
  const withoutDrive = n.replace(/^[A-Za-z]:\\/, "");
  return withoutDrive.split("\\").filter(Boolean);
}

export function stripDateCode(name: string): string {
  return name.replace(/^\d{6}\s+/, "").trim();
}

export function extractDateCode(name: string): string | null {
  const m = name.trim().match(/^(\d{6})(?:\s|$)/);
  return m ? m[1]! : null;
}

export function yearFromDateCode(code: string | null): string | null {
  if (!code || code.length < 2) return null;
  const yy = Number(code.slice(0, 2));
  if (yy < 10 || yy > 40) return null;
  return `20${code.slice(0, 2)}`;
}

export function yearFromPath(path: string): string | null {
  const m = path.match(/(?:^|[\\/])(20\d{2})(?:[\\/]|$)/);
  if (m) return m[1]!;
  const code = extractDateCode(path.split(/[\\/]/).pop() ?? "");
  return yearFromDateCode(code);
}

export function normalizeName(name: string): string {
  return stripDateCode(name)
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** pg_trgm 과 같은 3-gram Dice */
export function trigramSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (s: string) => {
    const padded = `  ${s} `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i += 1) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  const ga = grams(left);
  const gb = grams(right);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return (2 * inter) / (ga.size + gb.size);
}

export function inspireSeason(name: string): number | null {
  const m = name.match(/시즌\s*([0-9]+)|season\s*([0-9]+)/i);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isFinite(n) ? n : null;
}

export function isInspireName(name: string): boolean {
  return /인스파이어|inspire/i.test(name);
}

/** 인스파이어는 시즌이 같아야만 같은 건으로 본다. */
export function skipInspirePair(a: string, b: string): boolean {
  if (!isInspireName(a) || !isInspireName(b)) return false;
  const sa = inspireSeason(a);
  const sb = inspireSeason(b);
  if (sa == null || sb == null) return true;
  return sa !== sb;
}

export function parseWorkFolder(
  drive: string,
  relativePath: string
): WorkFolder | null {
  const segs = splitPathSegments(relativePath);
  if (segs.length < 3) return null;
  const root = segs[0]!;
  const year = segs[1]!;
  const project = segs[2]!;
  if (!ROOT_CLASS_RE.test(root)) return null;
  if (!YEAR_FOLDER_RE.test(year)) return null;
  const pm = project.match(PROJECT_FOLDER_RE);
  if (!pm) return null;
  const isBd = /사업개발/.test(root);
  const isDelivery = /project/i.test(root);
  if (!isBd && !isDelivery) return null;
  return {
    drive: (drive || "T").replace(/:$/, "").toUpperCase(),
    relativePath: normalizeWorkPath(relativePath).replace(/^\\+/, ""),
    fullPath: fullNasPath(drive, `${root}\\${year}\\${project}`),
    root,
    year,
    project,
    dateCode: pm[1]!,
    coreName: pm[2]!.trim(),
    isBd,
    isDelivery
  };
}

/** 파일·하위폴더가 어느 프로젝트 폴더에 속하는지 */
export function projectOfNasPath(
  drive: string,
  relativePath: string
): WorkFolder | null {
  const segs = splitPathSegments(relativePath);
  if (segs.length < 3) return null;
  return parseWorkFolder(drive, segs.slice(0, 3).join("\\"));
}

export function projectFromFullPath(fullPath: string): WorkFolder | null {
  const n = normalizeWorkPath(fullPath);
  const m = n.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return projectOfNasPath("T", n);
  return projectOfNasPath(m[1]!, m[2]!);
}

export function firstSubfolderLabel(
  relativePath: string,
  projectFolder: WorkFolder
): string | null {
  const prefix = `${projectFolder.root}\\${projectFolder.year}\\${projectFolder.project}\\`;
  const rel = normalizeWorkPath(relativePath).replace(/^\\+/, "");
  if (!rel.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = rel.slice(prefix.length);
  const next = rest.split("\\").filter(Boolean)[0];
  return next ?? null;
}

export type SameDecision =
  | { action: "drop" }
  | { action: "save"; confidence: number }
  | { action: "ask"; confidence: number }
  | { action: "llm" };

export function decideSame(
  similarity: number,
  sameDate: boolean
): SameDecision {
  if (similarity < LLM_SIM_MIN) return { action: "drop" };
  if (similarity >= 0.9) return { action: "save", confidence: 0.95 };
  if (similarity >= 0.6) {
    if (sameDate) return { action: "save", confidence: 0.8 };
    return { action: "ask", confidence: 0.6 };
  }
  return { action: "llm" };
}

export function statusFromConfidence(
  confidence: number
): "active" | "pending" {
  if (confidence >= LINK_AUTO_SAVE) return "active";
  if (confidence >= LINK_ASK_MIN) return "pending";
  return "pending";
}

export function haikuUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 5;
}

export const HUMAN_SAME_PAIRS: Array<{
  left: string;
  right: string;
  note: string;
}> = [
  {
    left: "260423 동탄더샵모델하우스",
    right: "260723 아크메르동탄 모델하우스",
    note: "블루진 확인"
  },
  {
    left: "260108 해운대스퀘어 공공부지사업",
    right: "260108 해운대구남로 미디어쇼",
    note: "블루진 확인"
  },
  {
    left: "260512 WTCS 무역센터",
    right: "260513 WTCS 무역센터",
    note: "블루진 확인"
  },
  {
    left: "260616 역삼미디어상설공간",
    right: "역삼미디어센터 증축 상업시설",
    note: "블루진 확인"
  },
  {
    left: "260713 더후 글로벌 론칭",
    right: "260701 더후 글로벌 프로모션 헤리티지 영상 제작",
    note: "블루진 확인"
  },
  {
    left: "260129 삼성디스플레이 시어터룸",
    right: "260129 삼성디스플레이 시어터룸",
    note: "Work=노션 동일"
  }
];
