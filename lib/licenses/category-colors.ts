/**
 * 카테고리 → 차트/도트용 HEX (목록 카드 tailwind 매핑과 동일한 분기).
 * 동일 문자열은 항상 동일 색.
 */

const EXPLICIT_CATEGORY_HEX: Record<string, string> = {
  "전사/공통": "#3b82f6",
  "기획/공통": "#10b981",
  "디자인/공통": "#a855f7",
  "디자인/공간": "#6366f1",
  "디자인/비주얼": "#8b5cf6",
  "디자인/비주얼,공간": "#d946ef",
  "개발/공통": "#06b6d4",
  "마케팅/공통": "#f97316",
  "콘텐츠/공통": "#f59e0b",
  "공간/공통": "#14b8a6",
  "전사/공": "#0ea5e9"
};

const AUTO_CATEGORY_HEX: string[] = [
  "#f43f5e",
  "#ec4899",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#0ea5e9",
  "#8b5cf6",
  "#d946ef",
  "#f59e0b",
  "#f97316"
];

function hashCategoryKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getCategoryColorHex(category: string | null | undefined): string {
  const c = (category ?? "").trim();
  if (EXPLICIT_CATEGORY_HEX[c]) {
    return EXPLICIT_CATEGORY_HEX[c];
  }
  const key = c || "__empty__";
  const idx = hashCategoryKey(key) % AUTO_CATEGORY_HEX.length;
  return AUTO_CATEGORY_HEX[idx];
}
