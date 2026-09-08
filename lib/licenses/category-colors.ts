/**
 * 카테고리 → 차트/도트용 HEX.
 * category_id 기준. 이름 변경에도 색이 유지된다.
 * (장기적으로 service_categories.color 컬럼을 두는 방안 가능)
 */

const EXPLICIT_CATEGORY_ID_HEX: Record<string, string> = {
  // 시드 6종 (2026-09 이관)
  "fa925ef5-fa20-4777-8ca2-e142f312ace1": "#3b82f6", // 전사/공통
  "938ed2cb-27f0-4276-8b87-e8a58cfa80b2": "#10b981", // 기획/공간
  "e5520952-fa86-4ed3-a7f7-893bfd5ad9d7": "#6366f1", // 디자인/공간
  "cb24abab-206d-436f-b1cf-1e4b21e53117": "#a855f7", // 디자인/공통
  "49e0dde2-dc62-4eff-865e-6f05d76253ec": "#8b5cf6", // 디자인/비주얼
  "3c491cba-f64d-4494-b02d-d1a903db1213": "#94a3b8" // 기타
};

/** @deprecated 이름 기반 — 레거시 호환용 */
const EXPLICIT_CATEGORY_NAME_HEX: Record<string, string> = {
  "전사/공통": "#3b82f6",
  "기획/공통": "#10b981",
  "기획/공간": "#10b981",
  "디자인/공통": "#a855f7",
  "디자인/공간": "#6366f1",
  "디자인/비주얼": "#8b5cf6",
  "디자인/비주얼,공간": "#d946ef",
  "개발/공통": "#06b6d4",
  "마케팅/공통": "#f97316",
  "콘텐츠/공통": "#f59e0b",
  "공간/공통": "#14b8a6",
  "전사/공": "#0ea5e9",
  기타: "#94a3b8"
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

export function getCategoryColorHex(
  categoryIdOrName: string | null | undefined
): string {
  const c = (categoryIdOrName ?? "").trim();
  if (!c) {
    return AUTO_CATEGORY_HEX[hashCategoryKey("__empty__") % AUTO_CATEGORY_HEX.length]!;
  }
  if (EXPLICIT_CATEGORY_ID_HEX[c]) return EXPLICIT_CATEGORY_ID_HEX[c]!;
  if (EXPLICIT_CATEGORY_NAME_HEX[c]) return EXPLICIT_CATEGORY_NAME_HEX[c]!;
  const idx = hashCategoryKey(c) % AUTO_CATEGORY_HEX.length;
  return AUTO_CATEGORY_HEX[idx]!;
}
