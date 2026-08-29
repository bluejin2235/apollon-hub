export type LocalizedText = { ko?: string; en?: string };

/** 칸 글(text-split · text-triple) body. 전폭 글은 { ko, en } 을 유지한다. */
export type BodyColumn = { ko?: string; en?: string };
export type ColumnsBody = { columns: BodyColumn[] };
export type BlockBodyJson = LocalizedText | ColumnsBody;

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
  no_key_image: boolean;
  key_image_size_unknown: boolean;
  key_image_not_16_9: boolean;
  key_image_too_small: boolean;
  body_image_too_small: boolean;
  empty_blocks: boolean;
  no_small_loop: boolean;
  faq_on_but_empty: boolean;
  too_many_anchors: boolean;
  no_tags: boolean;
  no_related: boolean;
  no_internal_folder: boolean;
  summary_too_long: boolean;
  duplicate_captions: boolean;
  duplicate_alts: boolean;
  image_count: number;
  caption_count: number;
  duplicate_caption_count?: number;
  duplicate_alt_count?: number;
  empty_block_count?: number;
  body_image_too_small_count?: number;
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

export type CheckInsights = {
  id: string;
  slug: string;
  title_ko: string | null;
  status: "draft" | "published";
  missing_summary_en: boolean;
  missing_key_alt: boolean;
  no_key_image: boolean;
  key_image_size_unknown: boolean;
  key_image_too_small: boolean;
  no_blocks: boolean;
  missing_body_en: boolean;
  missing_qa_en: boolean;
  empty_blocks: number | boolean;
  missing_image_alt: boolean;
  ai_unconfirmed: boolean;
  body_image_too_small: boolean;
  faq_on_but_empty: boolean;
  no_tags: boolean;
  no_related: boolean;
  summary_too_long: boolean;
  stale_draft: boolean;
  image_count: number;
};

export type InsightListItem = {
  id: string;
  slug: string;
  title: LocalizedText | null;
  status: "draft" | "published";
  category_id: string;
  year: string | null;
  published_at: string | null;
  key_image: string | null;
  key_image_width: number | null;
  key_image_height: number | null;
  show_faq: boolean;
  updated_at: string;
  counts: {
    blocks: number;
    images: number;
    tags: number;
    related: number;
  };
  check: CheckInsights | null;
};

export type InsightListData = {
  items: InsightListItem[];
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

export type UploadNotice = {
  kind: string;
  severity: "high" | "info" | string;
  title: string;
  lines: string[];
  how: string[];
};

export type ApiOk<T> = { ok: true; data: T; status: number; notice?: UploadNotice };
export type ApiErr = { ok: false; error: string; details?: unknown; status: number };
export type ApiResult<T> = ApiOk<T> | ApiErr;
