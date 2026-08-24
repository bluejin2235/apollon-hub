export type LocalizedText = { ko?: string; en?: string };

export type CheckWorks = {
  id: string;
  slug: string;
  title_ko: string | null;
  status: "draft" | "published";
  missing_summary_en: boolean;
  missing_key_alt: boolean;
  no_sections: boolean;
  missing_image_alt: boolean;
  ai_unconfirmed: boolean;
  no_small_loop: boolean;
  faq_on_but_empty: boolean;
  too_many_anchors: boolean;
  no_tags: boolean;
  no_related: boolean;
  no_internal_folder: boolean;
  summary_too_long: boolean;
  image_count: number;
  caption_count: number;
};

export type WorkListItem = {
  id: string;
  slug: string;
  title: LocalizedText | null;
  status: "draft" | "published";
  category_id: string;
  year: string | null;
  published_at: string | null;
  key_image: string | null;
  is_featured: boolean;
  show_faq: boolean;
  updated_at: string;
  counts: {
    sections: number;
    images: number;
    faqs: number;
    tags: number;
    related: number;
  };
  check: CheckWorks | null;
};

export type WorkListData = {
  items: WorkListItem[];
  total: number;
  page: number;
  limit: number;
};

export type WebsiteCategory = {
  id: string;
  label: LocalizedText;
  sort?: number;
};

export type WebsiteTag = {
  id: string;
  label: LocalizedText;
};

export type WebsiteMeta = {
  workCategories: WebsiteCategory[];
  insightCategories: WebsiteCategory[];
  tags: WebsiteTag[];
};

export type ApiOk<T> = { ok: true; data: T; status: number };
export type ApiErr = { ok: false; error: string; details?: unknown; status: number };
export type ApiResult<T> = ApiOk<T> | ApiErr;
