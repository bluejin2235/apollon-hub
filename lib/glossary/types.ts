export const GLOSSARY_CATEGORIES = [
  "공통",
  "공간",
  "HW",
  "콘텐츠",
  "기타"
] as const;

export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

export type GlossaryListItem = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  categories: GlossaryCategory[];
};

export type GlossaryVersionItem = {
  id: string;
  version: number;
  editor_type: "human" | "luna";
  editor_name: string | null;
  change_note: string | null;
  created_at: string;
};

export type GlossaryStats = {
  total: number;
  week_updated: number;
  pending_candidates: number;
  by_category: Record<GlossaryCategory, number | null>;
};

/** 편집/후보 폼 공통 필드 */
export type GlossaryFieldValues = {
  term_ko: string;
  term_en: string;
  term_zh: string;
  definition: string;
  categories: GlossaryCategory[];
};
