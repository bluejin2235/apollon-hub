import {
  GLOSSARY_CATEGORIES,
  type GlossaryCategory
} from "@/lib/glossary/types";

const LEGACY_MAP: Record<string, GlossaryCategory> = {
  common: "공통",
  interior: "공간",
  hw: "HW",
  공통: "공통",
  공간: "공간",
  HW: "HW",
  콘텐츠: "콘텐츠",
  기타: "기타",
  // 예전 UI 라벨
  인테리어: "공간",
  하드웨어: "HW"
};

export function isGlossaryCategory(raw: unknown): raw is GlossaryCategory {
  return (
    typeof raw === "string" &&
    (GLOSSARY_CATEGORIES as readonly string[]).includes(raw)
  );
}

/** 단일 값을 새 분류로 정규화. 모르면 null */
export function normalizeGlossaryCategory(
  raw: unknown
): GlossaryCategory | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (isGlossaryCategory(t)) return t;
  return LEGACY_MAP[t] ?? null;
}

/**
 * meta / DB / 요청 body 에서 categories 배열을 뽑는다.
 * 구 category 단일값도 수용. 비어 있으면 기본 ['공통'].
 */
export function normalizeCategories(
  raw: unknown,
  fallbackCategory?: unknown
): GlossaryCategory[] {
  const out: GlossaryCategory[] = [];
  const push = (v: unknown) => {
    const c = normalizeGlossaryCategory(v);
    if (c && !out.includes(c)) out.push(c);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else if (typeof raw === "string" && raw.trim()) {
    // "{공통,공간}" / "공통,공간" / 단일값
    const s = raw.trim().replace(/^\{|\}$/g, "");
    for (const part of s.split(/[,|]/)) push(part);
  }

  if (out.length === 0) push(fallbackCategory);
  if (out.length === 0) out.push("공통");
  return out;
}

export function toggleCategory(
  current: GlossaryCategory[],
  cat: GlossaryCategory
): GlossaryCategory[] {
  if (current.includes(cat)) {
    if (current.length <= 1) return current;
    return current.filter((c) => c !== cat);
  }
  return [...current, cat];
}

export function categoryTabFilter(
  categories: GlossaryCategory[] | null | undefined,
  tab: GlossaryCategory | "전체"
): boolean {
  if (tab === "전체") return true;
  return (categories ?? []).includes(tab);
}
