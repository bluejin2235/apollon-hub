import type { CheckInsights } from "@/lib/website/types";
import {
  asLoc,
  emptyLoc,
  type BlockImage,
  type Loc,
  type WorkRelated,
  type WorkTagEmbed
} from "@/lib/website/work-detail";

export type InsightEditorTab = "basic" | "content" | "related" | "history";

export type InsightSection = {
  id: string;
  insight_id: string;
  sort: number;
  headline: Loc | null;
  lead: Loc | null;
};

export type InsightBlock = {
  id: string;
  insight_id: string;
  section_id: string | null;
  sort: number;
  preset: string;
  body: Loc | null;
  question: Loc | null;
  answer: Loc | null;
  video_kind: string | null;
  video_url: string | null;
  poster: string | null;
  embed_provider: string | null;
  embed_url: string | null;
  embed_note: Loc | null;
  insight_images?: BlockImage[] | null;
};

export type InsightDetail = {
  id: string;
  slug: string;
  category_id: string;
  title: Loc | null;
  subtitle: Loc | null;
  summary: Loc | null;
  search_description: Loc | null;
  key_image: string | null;
  key_image_width: number | null;
  key_image_height: number | null;
  key_image_alt: Loc | null;
  key_image_ratio: string | null;
  quote: Loc | null;
  attribution: Loc | null;
  portrait: string | null;
  press_outlet: string | null;
  press_person: string | null;
  press_role: string | null;
  press_href: string | null;
  press_date: string | null;
  year: string | null;
  published_at: string | null;
  status: "draft" | "published";
  site_visibility: import("@/lib/website/types").WorkSiteVisibility;
  published_version: number | null;
  is_hidden: boolean;
  sort: number;
  show_faq: boolean;
  created_at: string;
  updated_at: string;
  insight_sections?: InsightSection[] | null;
  insight_blocks?: InsightBlock[] | null;
  insight_tags?: WorkTagEmbed[] | null;
  content_related?: WorkRelated[] | null;
  check?: CheckInsights | null;
};

export type InsightBasicDraft = {
  slug: string;
  category_id: string;
  title: Loc;
  subtitle: Loc;
  summary: Loc;
  search_description: Loc;
  key_image: string;
  key_image_width: number | null;
  key_image_height: number | null;
  key_image_alt: Loc;
  key_image_ratio: KeyImageRatio | "";
  press_outlet: string;
  press_href: string;
  press_date: string;
  year: string;
  published_at: string;
};

export type KeyImageRatio = "1:1" | "3:4" | "16:9";

export const KEY_IMAGE_RATIOS: KeyImageRatio[] = ["1:1", "3:4", "16:9"];

export function parseKeyImageRatio(value: unknown): KeyImageRatio | "" {
  if (value === "1:1" || value === "3:4" || value === "16:9") return value;
  return "";
}

export function parseInsightEditorTab(value: string | null): InsightEditorTab {
  if (value === "content" || value === "related" || value === "history") return value;
  return "basic";
}

export function isNewsCategory(categoryId: string) {
  return categoryId === "news";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function unwrapTag(value: unknown): { id: string; label: Loc } | null {
  const row = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  return { id: row.id, label: asLoc(row.label) };
}

function parseImage(value: unknown): BlockImage | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    block_id: asString(row.block_id),
    sort: asNum(row.sort),
    src: asString(row.src),
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    alt: row.alt ? asLoc(row.alt) : null,
    caption: row.caption ? asLoc(row.caption) : null,
    caption_visible: asBool(row.caption_visible),
    ai_generated: asBool(row.ai_generated),
    ai_confirmed: asBool(row.ai_confirmed)
  };
}

function parseBlock(value: unknown): InsightBlock | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    insight_id: asString(row.insight_id),
    section_id: typeof row.section_id === "string" ? row.section_id : null,
    sort: asNum(row.sort),
    preset: typeof row.preset === "string" ? row.preset : "text",
    body: row.body ? asLoc(row.body) : null,
    question: row.question ? asLoc(row.question) : null,
    answer: row.answer ? asLoc(row.answer) : null,
    video_kind: typeof row.video_kind === "string" ? row.video_kind : null,
    video_url: typeof row.video_url === "string" ? row.video_url : null,
    poster: typeof row.poster === "string" ? row.poster : null,
    embed_provider: typeof row.embed_provider === "string" ? row.embed_provider : null,
    embed_url: typeof row.embed_url === "string" ? row.embed_url : null,
    embed_note: row.embed_note ? asLoc(row.embed_note) : null,
    insight_images: asArray(row.insight_images)
      .map(parseImage)
      .filter((v): v is BlockImage => v !== null)
  };
}

export function parseInsightDetail(value: unknown): InsightDetail | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  const status = row.status === "published" ? "published" : "draft";
  const siteVisibility =
    row.site_visibility === "live" || row.site_visibility === "hidden"
      ? row.site_visibility
      : "draft";
  const check = asRecord(row.check);

  return {
    id: row.id,
    slug: asString(row.slug),
    category_id: asString(row.category_id),
    title: row.title ? asLoc(row.title) : null,
    subtitle: row.subtitle ? asLoc(row.subtitle) : null,
    summary: row.summary ? asLoc(row.summary) : null,
    search_description: row.search_description ? asLoc(row.search_description) : null,
    key_image: typeof row.key_image === "string" ? row.key_image : null,
    key_image_width: typeof row.key_image_width === "number" ? row.key_image_width : null,
    key_image_height: typeof row.key_image_height === "number" ? row.key_image_height : null,
    key_image_alt: row.key_image_alt ? asLoc(row.key_image_alt) : null,
    key_image_ratio: parseKeyImageRatio(row.key_image_ratio) || null,
    quote: row.quote ? asLoc(row.quote) : null,
    attribution: row.attribution ? asLoc(row.attribution) : null,
    portrait: typeof row.portrait === "string" ? row.portrait : null,
    press_outlet: typeof row.press_outlet === "string" ? row.press_outlet : null,
    press_person: typeof row.press_person === "string" ? row.press_person : null,
    press_role: typeof row.press_role === "string" ? row.press_role : null,
    press_href: typeof row.press_href === "string" ? row.press_href : null,
    press_date:
      typeof row.press_date === "string"
        ? row.press_date.slice(0, 10)
        : null,
    year: typeof row.year === "string" ? row.year : null,
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    status,
    site_visibility: siteVisibility,
    published_version: typeof row.published_version === "number" ? row.published_version : null,
    is_hidden: row.is_hidden === true,
    sort: asNum(row.sort),
    show_faq: asBool(row.show_faq),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    insight_sections: asArray(row.insight_sections)
      .map((item) => {
        const s = asRecord(item);
        if (!s || typeof s.id !== "string") return null;
        return {
          id: s.id,
          insight_id: asString(s.insight_id) || asString(row.id),
          sort: asNum(s.sort),
          headline: s.headline ? asLoc(s.headline) : null,
          lead: s.lead ? asLoc(s.lead) : null
        };
      })
      .filter((v): v is InsightSection => v !== null),
    insight_blocks: asArray(row.insight_blocks)
      .map(parseBlock)
      .filter((v): v is InsightBlock => v !== null),
    insight_tags: asArray(row.insight_tags)
      .map((item) => {
        const t = asRecord(item);
        if (!t || typeof t.tag_id !== "string") return null;
        return { sort: asNum(t.sort), tag_id: t.tag_id, tags: unwrapTag(t.tags) };
      })
      .filter((v): v is WorkTagEmbed => v !== null),
    content_related: asArray(row.content_related)
      .map((item) => {
        const r = asRecord(item);
        if (!r || typeof r.id !== "string") return null;
        return {
          id: r.id,
          sort: asNum(r.sort),
          target_type: asString(r.target_type),
          target_work_id: typeof r.target_work_id === "string" ? r.target_work_id : null,
          target_insight_id: typeof r.target_insight_id === "string" ? r.target_insight_id : null,
          target_page_key: typeof r.target_page_key === "string" ? r.target_page_key : null,
          picked_by: r.picked_by === "luna" ? "luna" : "human"
        };
      })
      .filter((v): v is WorkRelated => v !== null),
    check: check
      ? {
          id: asString(check.id) || row.id,
          slug: asString(check.slug) || asString(row.slug),
          title_ko: typeof check.title_ko === "string" ? check.title_ko : null,
          status,
          missing_summary_en: asBool(check.missing_summary_en),
          missing_key_alt: asBool(check.missing_key_alt),
          no_key_image: asBool(check.no_key_image),
          key_image_size_unknown: asBool(check.key_image_size_unknown),
          key_image_too_small: asBool(check.key_image_too_small),
          no_blocks: asBool(check.no_blocks),
          missing_body_en: asBool(check.missing_body_en),
          missing_qa_en: asBool(check.missing_qa_en),
          empty_blocks: typeof check.empty_blocks === "number" ? check.empty_blocks : asBool(check.empty_blocks) ? 1 : 0,
          missing_image_alt: asBool(check.missing_image_alt),
          ai_unconfirmed: asBool(check.ai_unconfirmed),
          body_image_too_small: asBool(check.body_image_too_small),
          faq_on_but_empty: asBool(check.faq_on_but_empty),
          no_tags: asBool(check.no_tags),
          no_related: asBool(check.no_related),
          summary_too_long: asBool(check.summary_too_long),
          stale_draft: asBool(check.stale_draft),
          image_count: asNum(check.image_count)
        }
      : null
  };
}

export function draftFromInsight(insight: InsightDetail): InsightBasicDraft {
  return {
    slug: insight.slug ?? "",
    category_id: insight.category_id ?? "",
    title: asLoc(insight.title),
    subtitle: asLoc(insight.subtitle),
    summary: asLoc(insight.summary),
    search_description: asLoc(insight.search_description),
    key_image: insight.key_image ?? "",
    key_image_width: insight.key_image_width ?? null,
    key_image_height: insight.key_image_height ?? null,
    key_image_alt: asLoc(insight.key_image_alt),
    key_image_ratio: parseKeyImageRatio(insight.key_image_ratio),
    press_outlet: insight.press_outlet ?? "",
    press_href: insight.press_href ?? "",
    press_date: (insight.press_date ?? "").slice(0, 10),
    year: insight.year ?? "",
    published_at: (insight.published_at ?? "").slice(0, 10)
  };
}

export function insightPatchFromDraft(draft: InsightBasicDraft): Record<string, unknown> {
  const news = isNewsCategory(draft.category_id);
  return {
    slug: draft.slug,
    category_id: draft.category_id,
    title: draft.title,
    subtitle: draft.subtitle,
    summary: draft.summary,
    search_description: draft.search_description,
    key_image: draft.key_image || null,
    key_image_width: draft.key_image ? draft.key_image_width : null,
    key_image_height: draft.key_image ? draft.key_image_height : null,
    key_image_alt: draft.key_image_alt,
    key_image_ratio: draft.key_image ? draft.key_image_ratio || null : null,
    press_outlet: news ? draft.press_outlet.trim() || null : null,
    press_href: news ? draft.press_href.trim() || null : null,
    press_date: news ? draft.press_date.trim() || null : null,
    year: draft.year || null,
    published_at: draft.published_at || null
  };
}

export function countInsightAiUnconfirmed(insight: InsightDetail): number {
  let n = 0;
  for (const block of insight.insight_blocks ?? []) {
    for (const image of block.insight_images ?? []) {
      if (image.ai_generated && !image.ai_confirmed) n += 1;
    }
  }
  return n;
}

export function emptyInsightLoc(): Loc {
  return emptyLoc();
}

export function emptyInsightCheck(insight: InsightDetail): CheckInsights {
  return {
    id: insight.id,
    slug: insight.slug,
    title_ko: insight.title?.ko ?? null,
    status: insight.status,
    missing_summary_en: false,
    missing_key_alt: false,
    no_key_image: false,
    key_image_size_unknown: false,
    key_image_too_small: false,
    no_blocks: false,
    missing_body_en: false,
    missing_qa_en: false,
    empty_blocks: 0,
    missing_image_alt: false,
    ai_unconfirmed: false,
    body_image_too_small: false,
    faq_on_but_empty: false,
    no_tags: false,
    no_related: false,
    summary_too_long: false,
    stale_draft: false,
    image_count: 0
  };
}
