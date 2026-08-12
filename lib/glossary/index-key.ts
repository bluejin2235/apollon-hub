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

/** 색인 버튼 정렬 순서: 초성 14자 → A~Z → 기타 */
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

/**
 * 용어 한 건의 색인 키.
 * 한글로 시작하면 초성, 알파벳으로 시작하면 대문자, 그 외는 "#".
 */
export function indexKeyOf(termKo: string | null | undefined): string {
  const first = (termKo ?? "").trim().charAt(0);
  if (!first) return OTHER_INDEX_KEY;
  const cho = chosungOf(first);
  if (cho) return cho;
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  return OTHER_INDEX_KEY;
}

function rank(key: string): number {
  const ko = KO_INDEX_ORDER.indexOf(key as (typeof KO_INDEX_ORDER)[number]);
  if (ko >= 0) return ko;
  if (/^[A-Z]$/.test(key)) return 100 + key.charCodeAt(0);
  return 9999;
}

/** 실제 데이터에 존재하는 색인 키만 정렬해서 돌려준다 */
export function buildIndexKeys(terms: Array<{ term_ko: string }>): string[] {
  const keys = new Set<string>();
  for (const t of terms) keys.add(indexKeyOf(t.term_ko));
  return Array.from(keys).sort((a, b) => rank(a) - rank(b));
}
