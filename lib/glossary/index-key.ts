const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 유니코드 한글 음절의 초성 19자 (순서 고정) */
const CHOSUNG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ"
] as const;

/** 쌍자음은 사전 색인에서 기본 자음으로 묶는다 (까 → ㄱ) */
const DOUBLE_TO_BASE: Record<string, string> = {
  ㄲ: "ㄱ",
  ㄸ: "ㄷ",
  ㅃ: "ㅂ",
  ㅆ: "ㅅ",
  ㅉ: "ㅈ"
};

/** 색인 그룹 */
export type IndexGroup = "all" | "ko" | "en" | "num";

export const INDEX_GROUPS: Array<{ key: IndexGroup; label: string }> = [
  { key: "all", label: "전체" },
  { key: "ko", label: "가나다" },
  { key: "en", label: "ABC" },
  { key: "num", label: "123" }
];

/** 초성 버튼 정렬 순서 */
export const KO_INDEX_ORDER = [
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ"
] as const;

/** 숫자·특수문자 그룹의 기타 키 */
export const OTHER_INDEX_KEY = "#";

/** 한글 음절 한 글자의 초성을 뽑는다. 한글이 아니면 null */
export function chosungOf(char: string): string | null {
  if (!char) return null;
  const code = char.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const cho = CHOSUNG[Math.floor((code - HANGUL_BASE) / 588)];
  if (!cho) return null;
  return DOUBLE_TO_BASE[cho] ?? cho;
}

export type IndexKind = "ko" | "en" | "num";

export type IndexableTerm = {
  term_ko?: string | null;
  term_en?: string | null;
  term_zh?: string | null;
};

/** 제목 표기 규칙: term_ko → term_en → term_zh */
export function titleKeyOf(term: IndexableTerm): string {
  const ko = (term.term_ko ?? "").trim();
  if (ko) return ko;
  const en = (term.term_en ?? "").trim();
  if (en) return en;
  return (term.term_zh ?? "").trim();
}

/**
 * 용어 한 건의 색인 (제목 표기 규칙 기준).
 * - 한글 → 초성
 * - 알파벳 → 대문자
 * - 숫자 → 해당 숫자 문자 ("0"…"9")
 * - 그 외 특수문자 → "#"
 */
export function indexInfoOf(term: IndexableTerm | string | null | undefined): {
  kind: IndexKind;
  key: string;
} {
  const title =
    typeof term === "string" || term == null
      ? (term ?? "").trim()
      : titleKeyOf(term);
  const first = title.charAt(0);
  if (!first) return { kind: "num", key: OTHER_INDEX_KEY };
  const cho = chosungOf(first);
  if (cho) return { kind: "ko", key: cho };
  if (/[a-zA-Z]/.test(first)) return { kind: "en", key: first.toUpperCase() };
  if (/[0-9]/.test(first)) return { kind: "num", key: first };
  return { kind: "num", key: OTHER_INDEX_KEY };
}

/** @deprecated indexInfoOf 사용. 하위 호환용 */
export function indexKeyOf(termKo: string | null | undefined): string {
  return indexInfoOf(termKo).key;
}

function rankKey(kind: IndexKind, key: string): number {
  if (kind === "ko") {
    const i = KO_INDEX_ORDER.indexOf(key as (typeof KO_INDEX_ORDER)[number]);
    return i >= 0 ? i : 50;
  }
  if (kind === "en") return 100 + key.charCodeAt(0);
  if (/^[0-9]$/.test(key)) return 200 + Number(key);
  return 300;
}

/** 그룹에 속하는 글자 버튼 목록 (데이터에 있는 것만) */
export function buildIndexKeysForGroup(
  terms: IndexableTerm[],
  group: IndexGroup
): string[] {
  if (group === "all") return [];
  const keys = new Set<string>();
  for (const t of terms) {
    const info = indexInfoOf(t);
    if (info.kind !== group) continue;
    keys.add(info.key);
  }
  return Array.from(keys).sort(
    (a, b) => rankKey(group, a) - rankKey(group, b)
  );
}

/** 그룹·글자 필터 */
export function matchesIndexFilter(
  term: IndexableTerm,
  group: IndexGroup,
  letter: string | null
): boolean {
  if (group === "all") return true;
  const info = indexInfoOf(term);
  if (info.kind !== group) return false;
  if (!letter) return true;
  return info.key === letter;
}

/** 실제 데이터에 존재하는 색인 키만 (구 API 호환) */
export function buildIndexKeys(terms: Array<{ term_ko: string }>): string[] {
  const keys = new Set<string>();
  for (const t of terms) keys.add(indexKeyOf(t.term_ko));
  return Array.from(keys).sort((a, b) => {
    const kindOf = (k: string): IndexKind =>
      /[ㄱ-ㅎ]/.test(k) ? "ko" : /^[A-Z]$/.test(k) ? "en" : "num";
    return rankKey(kindOf(a), a) - rankKey(kindOf(b), b);
  });
}
