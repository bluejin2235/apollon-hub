export type GlossaryCategory = "common" | "interior" | "hw";

export type GlossaryListItem = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  term_zh_pron: string | null;
  category: GlossaryCategory;
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
  by_category: {
    common: number | null;
    interior: number | null;
    hw: number | null;
  };
};
