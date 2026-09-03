export type Loc = { ko: string; en: string };

/** 전폭 글은 { ko, en }. 칸 글만 columns. 둘을 섞어 저장하지 않는다. */
export type ColumnsBody = { columns: Loc[] };
export type BlockBody = Loc | ColumnsBody;

export type WorkCredit = {
  id: string;
  work_id: string;
  sort: number;
  role: string;
  name: Loc | null;
};

export type WorkMetric = {
  id: string;
  work_id: string;
  sort: number;
  value: Loc | null;
};

export type WorkFolder = {
  id: string;
  work_id: string;
  kind: "ko" | "en" | "extra";
  path: string;
  name: string;
  sort: number;
};

export type WorkTagEmbed = {
  sort: number;
  tag_id: string;
  tags: { id: string; label: Loc } | null;
};

export type BlockImage = {
  id: string;
  block_id: string;
  sort: number;
  src: string;
  width: number | null;
  height: number | null;
  alt: Loc | null;
  caption: Loc | null;
  caption_visible: boolean;
  ai_generated: boolean;
  ai_confirmed: boolean;
};

export type ContentBlock = {
  id: string;
  section_id: string;
  sort: number;
  preset: string;
  body: BlockBody | null;
  video_kind: string | null;
  video_url: string | null;
  video_poster: string | null;
  video_alt: Loc | null;
  embed_provider: string | null;
  embed_url: string | null;
  embed_title: Loc | null;
  embed_poster: string | null;
  gallery_row_height: number | null;
  text_side: "left" | "right" | null;
  from_library_id: string | null;
  show_meta: boolean;
  caption: Loc | null;
  caption_visible: boolean;
  block_images?: BlockImage[] | null;
};

export type WorkSection = {
  id: string;
  work_id: string;
  sort: number;
  kind: "basic" | "interview";
  headline: Loc | null;
  lead: Loc | null;
  content_blocks?: ContentBlock[] | null;
};

export type WorkFaq = {
  id: string;
  work_id: string | null;
  question: Loc | null;
  answer: Loc | null;
  sort: number;
};

export type WorkRelated = {
  id: string;
  sort: number;
  target_type: string;
  target_work_id: string | null;
  target_insight_id: string | null;
  target_page_key: string | null;
  picked_by: "human" | "luna";
};

export type WorkInterview = {
  section_id: string;
  work_id: string;
  insight_id: string;
  quote_override: Loc | null;
  attribution_override: Loc | null;
};

export type WorkDetail = {
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
  card_image: string | null;
  card_image_source: string | null;
  card_image_width: number | null;
  card_image_height: number | null;
  loop_video_lg: string | null;
  loop_video_sm: string | null;
  loop_lg_posters: string[];
  loop_sm_posters: string[];
  client: Loc | null;
  location_country: Loc | null;
  location_city: Loc | null;
  location_address: Loc | null;
  scale: Loc | null;
  awards: Loc | null;
  year: string | null;
  published_at: string | null;
  status: "draft" | "published";
  sort: number;
  is_featured: boolean;
  show_faq: boolean;
  created_at: string;
  updated_at: string;
  work_sections?: WorkSection[] | null;
  work_credits?: WorkCredit[] | null;
  work_metrics?: WorkMetric[] | null;
  work_folders?: WorkFolder[] | null;
  work_categories_map?: WorkCategoryMap[] | null;
  work_tags?: WorkTagEmbed[] | null;
  faqs?: WorkFaq[] | null;
  content_related?: WorkRelated[] | null;
  work_interview?: WorkInterview[] | null;
  check?: import("@/lib/website/types").CheckWorks | null;
  site_visibility: import("@/lib/website/types").WorkSiteVisibility;
  published_version: number | null;
  is_hidden: boolean;
};

export type WorkCategoryMap = {
  category_id: string;
  sort: number;
};

export type WorkBasicDraft = {
  slug: string;
  /** work_categories_map 순서. 첫 번째가 대표이고 works.category_id 가 됩니다 */
  category_ids: string[];
  category_id: string;
  title: Loc;
  subtitle: Loc;
  summary: Loc;
  search_description: Loc;
  key_image: string;
  key_image_width: number | null;
  key_image_height: number | null;
  key_image_alt: Loc;
  card_image: string;
  card_image_source: string;
  card_image_width: number | null;
  card_image_height: number | null;
  loop_video_lg: string;
  loop_video_sm: string;
  loop_lg_posters: string[];
  loop_sm_posters: string[];
  client: Loc;
  location_country: Loc;
  location_city: Loc;
  location_address: Loc;
  scale: Loc;
  awards: Loc;
  year: string;
  published_at: string;
  is_featured: boolean;
  show_faq: boolean;
};

export function emptyLoc(): Loc {
  return { ko: "", en: "" };
}

export function asLoc(value: unknown): Loc {
  if (!value || typeof value !== "object") return emptyLoc();
  const row = value as Record<string, unknown>;
  return {
    ko: typeof row.ko === "string" ? row.ko : "",
    en: typeof row.en === "string" ? row.en : ""
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

export function hasColumns(value: unknown): value is { columns: unknown[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as { columns?: unknown }).columns)
  );
}

export function asBlockBody(value: unknown): BlockBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (hasColumns(value)) {
    return { columns: value.columns.map(asLoc) };
  }
  return asLoc(value);
}

/** 칸 글 편집용. columns 가 없으면 { ko, en } 을 첫 칸으로만 쓴다. */
export function columnsFromBody(value: unknown, count: number): Loc[] {
  const next: Loc[] = [];
  if (hasColumns(value)) {
    for (const item of value.columns) next.push(asLoc(item));
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const loc = asLoc(value);
    if (loc.ko || loc.en) next.push(loc);
  }
  while (next.length < count) next.push(emptyLoc());
  return next.slice(0, count);
}

export type EditorTab =
  | "basic"
  | "content"
  | "interview"
  | "credits"
  | "faq"
  | "related"
  | "history";

export function parseEditorTab(value: string | null): EditorTab {
  if (
    value === "content" ||
    value === "interview" ||
    value === "credits" ||
    value === "faq" ||
    value === "related" ||
    value === "history"
  ) {
    return value;
  }
  return "basic";
}

export function locOrNull(value: Loc): Loc | null {
  return value.ko.trim() || value.en.trim() ? value : null;
}

export function interviewSectionOf(work: WorkDetail): WorkSection | null {
  return (work.work_sections ?? []).find((section) => section.kind === "interview") ?? null;
}

export function interviewRowOf(work: WorkDetail): WorkInterview | null {
  const rows = work.work_interview ?? [];
  return rows[0] ?? null;
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

function fallbackPreset(row: Record<string, unknown>): string {
  if (typeof row.preset === "string" && row.preset) return row.preset;
  if (row.type === "paragraph") return "text-only";
  if (row.type === "video") return "video-full";
  if (
    row.layout === "split" ||
    row.layout === "offset" ||
    row.layout === "offset-reverse" ||
    row.layout === "full"
  ) {
    return row.layout;
  }
  return "full";
}

function parseBlock(value: unknown): ContentBlock | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  const textSide = row.text_side === "left" || row.text_side === "right" ? row.text_side : null;
  return {
    id: row.id,
    section_id: asString(row.section_id),
    sort: asNum(row.sort),
    preset: fallbackPreset(row),
    body: row.body ? asBlockBody(row.body) : null,
    video_kind: typeof row.video_kind === "string" ? row.video_kind : null,
    video_url: typeof row.video_url === "string" ? row.video_url : null,
    video_poster: typeof row.video_poster === "string" ? row.video_poster : null,
    video_alt: row.video_alt ? asLoc(row.video_alt) : null,
    embed_provider: typeof row.embed_provider === "string" ? row.embed_provider : null,
    embed_url: typeof row.embed_url === "string" ? row.embed_url : null,
    embed_title: row.embed_title ? asLoc(row.embed_title) : null,
    embed_poster: typeof row.embed_poster === "string" ? row.embed_poster : null,
    gallery_row_height: typeof row.gallery_row_height === "number" ? row.gallery_row_height : null,
    text_side: textSide,
    from_library_id: typeof row.from_library_id === "string" ? row.from_library_id : null,
    show_meta: row.show_meta === true,
    caption: row.caption ? asLoc(row.caption) : null,
    caption_visible: asBool(row.caption_visible),
    block_images: asArray(row.block_images).map(parseImage).filter((v): v is BlockImage => v !== null)
  };
}

function parseSection(value: unknown): WorkSection | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    work_id: asString(row.work_id),
    sort: asNum(row.sort),
    kind: row.kind === "interview" ? "interview" : "basic",
    headline: row.headline ? asLoc(row.headline) : null,
    lead: row.lead ? asLoc(row.lead) : null,
    content_blocks: asArray(row.content_blocks)
      .map(parseBlock)
      .filter((v): v is ContentBlock => v !== null)
  };
}

export function parseWorkDetail(value: unknown): WorkDetail | null {
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
    card_image: typeof row.card_image === "string" ? row.card_image : null,
    card_image_source: typeof row.card_image_source === "string" ? row.card_image_source : null,
    card_image_width: typeof row.card_image_width === "number" ? row.card_image_width : null,
    card_image_height: typeof row.card_image_height === "number" ? row.card_image_height : null,
    loop_video_lg: typeof row.loop_video_lg === "string" ? row.loop_video_lg : null,
    loop_video_sm: typeof row.loop_video_sm === "string" ? row.loop_video_sm : null,
    loop_lg_posters: asStringList(row.loop_lg_posters),
    loop_sm_posters: asStringList(row.loop_sm_posters),
    client: row.client ? asLoc(row.client) : null,
    location_country: row.location_country ? asLoc(row.location_country) : null,
    location_city: row.location_city ? asLoc(row.location_city) : null,
    location_address: row.location_address ? asLoc(row.location_address) : null,
    scale: row.scale ? asLoc(row.scale) : null,
    awards: row.awards ? asLoc(row.awards) : null,
    year: typeof row.year === "string" ? row.year : null,
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    status,
    site_visibility: siteVisibility,
    published_version: typeof row.published_version === "number" ? row.published_version : null,
    is_hidden: row.is_hidden === true,
    sort: asNum(row.sort),
    is_featured: asBool(row.is_featured),
    show_faq: asBool(row.show_faq),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    work_sections: asArray(row.work_sections)
      .map(parseSection)
      .filter((v): v is WorkSection => v !== null),
    work_credits: asArray(row.work_credits)
      .map((item) => {
        const c = asRecord(item);
        if (!c || typeof c.id !== "string") return null;
        return {
          id: c.id,
          work_id: asString(c.work_id),
          sort: asNum(c.sort),
          role: asString(c.role),
          name: c.name ? asLoc(c.name) : null
        };
      })
      .filter((v): v is WorkCredit => v !== null),
    work_metrics: asArray(row.work_metrics)
      .map((item) => {
        const m = asRecord(item);
        if (!m || typeof m.id !== "string") return null;
        return {
          id: m.id,
          work_id: asString(m.work_id),
          sort: asNum(m.sort),
          value: m.value ? asLoc(m.value) : null
        };
      })
      .filter((v): v is WorkMetric => v !== null),
    work_folders: asArray(row.work_folders)
      .map((item) => {
        const f = asRecord(item);
        if (!f || typeof f.id !== "string") return null;
        const kind = f.kind === "en" || f.kind === "extra" ? f.kind : "ko";
        return {
          id: f.id,
          work_id: asString(f.work_id),
          kind,
          path: asString(f.path),
          name: asString(f.name),
          sort: asNum(f.sort)
        };
      })
      .filter((v): v is WorkFolder => v !== null),
    work_categories_map: asArray(row.work_categories_map)
      .map((item) => {
        const m = asRecord(item);
        if (!m || typeof m.category_id !== "string") return null;
        return { category_id: m.category_id, sort: asNum(m.sort) } satisfies WorkCategoryMap;
      })
      .filter((v): v is WorkCategoryMap => v !== null)
      .sort((a, b) => a.sort - b.sort),
    work_tags: asArray(row.work_tags)
      .map((item) => {
        const t = asRecord(item);
        if (!t || typeof t.tag_id !== "string") return null;
        return { sort: asNum(t.sort), tag_id: t.tag_id, tags: unwrapTag(t.tags) } satisfies WorkTagEmbed;
      })
      .filter((v): v is WorkTagEmbed => v !== null),
    faqs: asArray(row.faqs)
      .map((item) => {
        const f = asRecord(item);
        if (!f || typeof f.id !== "string") return null;
        return {
          id: f.id,
          work_id: typeof f.work_id === "string" ? f.work_id : null,
          question: f.question ? asLoc(f.question) : null,
          answer: f.answer ? asLoc(f.answer) : null,
          sort: asNum(f.sort)
        };
      })
      .filter((v): v is WorkFaq => v !== null),
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
    work_interview: asArray(row.work_interview)
      .map((item) => {
        const i = asRecord(item);
        if (!i || typeof i.section_id !== "string") return null;
        return {
          section_id: i.section_id,
          work_id: asString(i.work_id),
          insight_id: asString(i.insight_id),
          quote_override: i.quote_override ? asLoc(i.quote_override) : null,
          attribution_override: i.attribution_override ? asLoc(i.attribution_override) : null
        };
      })
      .filter((v): v is WorkInterview => v !== null),
    check: check
      ? ({
          id: asString(check.id) || row.id,
          slug: asString(check.slug) || asString(row.slug),
          title_ko: typeof check.title_ko === "string" ? check.title_ko : null,
          status,
          missing_summary_en: asBool(check.missing_summary_en),
          missing_key_alt: asBool(check.missing_key_alt),
          no_key_image: asBool(check.no_key_image),
          key_image_size_unknown: asBool(check.key_image_size_unknown),
          key_image_not_16_9: false,
          not_16_9: false,
          key_image_too_small: asBool(check.key_image_too_small),
          body_image_too_small: asBool(check.body_image_too_small),
          empty_blocks: asBool(check.empty_blocks),
          no_sections: asBool(check.no_sections),
          missing_image_alt: asBool(check.missing_image_alt),
          ai_unconfirmed: asBool(check.ai_unconfirmed),
          no_small_loop: asBool(check.no_small_loop),
          faq_on_but_empty: asBool(check.faq_on_but_empty),
          too_many_anchors: asBool(check.too_many_anchors),
          no_tags: asBool(check.no_tags),
          no_related: asBool(check.no_related),
          no_internal_folder: asBool(check.no_internal_folder),
          duplicate_captions: asBool(check.duplicate_captions),
          duplicate_alts: asBool(check.duplicate_alts),
          image_count: asNum(check.image_count),
          caption_count: asNum(check.caption_count),
          duplicate_caption_count:
            typeof check.duplicate_caption_count === "number"
              ? check.duplicate_caption_count
              : undefined,
          duplicate_alt_count:
            typeof check.duplicate_alt_count === "number" ? check.duplicate_alt_count : undefined,
          empty_block_count:
            typeof check.empty_block_count === "number" ? check.empty_block_count : undefined,
          body_image_too_small_count:
            typeof check.body_image_too_small_count === "number"
              ? check.body_image_too_small_count
              : undefined,
          not_16_9_count:
            typeof check.not_16_9_count === "number" ? check.not_16_9_count : undefined
        } satisfies import("@/lib/website/types").CheckWorks)
      : null
  };
}

/** work_categories_map 을 sort 순서로 펴고, 비어 있으면 대표 하나만 씁니다 */
export function categoryIdsFromMap(
  map: WorkCategoryMap[] | null | undefined,
  fallbackCategoryId?: string | null
): string[] {
  const ids: string[] = [];

  for (const row of [...(map ?? [])].sort((a, b) => a.sort - b.sort)) {
    if (row.category_id && !ids.includes(row.category_id)) ids.push(row.category_id);
  }

  if (ids.length > 0) return ids;
  return fallbackCategoryId ? [fallbackCategoryId] : [];
}

export function categoryIdsFromWork(work: WorkDetail): string[] {
  return categoryIdsFromMap(work.work_categories_map, work.category_id);
}

export function categoryLabelsFromIds(
  ids: string[],
  labelById: Map<string, string>
): string {
  return ids.map((id) => labelById.get(id) ?? id).join(" · ");
}

export function draftFromWork(work: WorkDetail): WorkBasicDraft {
  return {
    slug: work.slug ?? "",
    category_ids: categoryIdsFromWork(work),
    category_id: work.category_id ?? "",
    title: asLoc(work.title),
    subtitle: asLoc(work.subtitle),
    summary: asLoc(work.summary),
    search_description: asLoc(work.search_description),
    key_image: work.key_image ?? "",
    key_image_width: work.key_image_width ?? null,
    key_image_height: work.key_image_height ?? null,
    key_image_alt: asLoc(work.key_image_alt),
    card_image: work.card_image ?? "",
    card_image_source: work.card_image_source ?? "",
    card_image_width: work.card_image_width ?? null,
    card_image_height: work.card_image_height ?? null,
    loop_video_lg: work.loop_video_lg ?? "",
    loop_video_sm: work.loop_video_sm ?? "",
    loop_lg_posters: [...(work.loop_lg_posters ?? [])],
    loop_sm_posters: [...(work.loop_sm_posters ?? [])],
    client: asLoc(work.client),
    location_country: asLoc(work.location_country),
    location_city: asLoc(work.location_city),
    location_address: asLoc(work.location_address),
    scale: asLoc(work.scale),
    awards: asLoc(work.awards),
    year: work.year ?? "",
    published_at: (work.published_at ?? "").slice(0, 10) || todayYmd(),
    is_featured: work.is_featured,
    show_faq: work.show_faq
  };
}

export function worksPatchFromDraft(draft: WorkBasicDraft): Record<string, unknown> {
  return {
    slug: draft.slug,
    // 대표는 항상 첫 번째입니다.
    category_id: draft.category_ids[0] || draft.category_id,
    title: { ko: draft.title.en || draft.title.ko, en: draft.title.en || draft.title.ko },
    subtitle: draft.subtitle,
    summary: draft.summary,
    search_description: draft.search_description,
    key_image: draft.key_image || null,
    key_image_width: draft.key_image ? draft.key_image_width : null,
    key_image_height: draft.key_image ? draft.key_image_height : null,
    key_image_alt: draft.key_image_alt,
    card_image: draft.card_image || null,
    card_image_source: draft.card_image ? draft.card_image_source || null : null,
    card_image_width: draft.card_image ? draft.card_image_width : null,
    card_image_height: draft.card_image ? draft.card_image_height : null,
    loop_video_lg: draft.loop_video_lg || null,
    loop_video_sm: draft.loop_video_sm || null,
    loop_lg_posters: draft.loop_lg_posters,
    loop_sm_posters: [],
    client: draft.client,
    location_country: draft.location_country,
    location_city: draft.location_city,
    location_address: draft.location_address,
    scale: draft.scale,
    awards: draft.awards,
    year: draft.year || null,
    published_at: draft.published_at || null,
    is_featured: draft.is_featured,
    show_faq: draft.show_faq
  };
}

export function fileName(src: string | null | undefined): string {
  if (!src) return "";
  const clean = src.split("?")[0] ?? src;
  const parts = clean.split("/");
  const raw = parts[parts.length - 1] || clean;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function mediaUrl(siteUrl: string, src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

export function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatSavedAt(iso: string | null | undefined): string {
  if (!iso) return "저장된 적 없음";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function tagLabel(embed: WorkTagEmbed): string {
  return embed.tags?.label.ko || embed.tags?.label.en || embed.tag_id;
}

export function countAiUnconfirmed(work: WorkDetail): number {
  let n = 0;
  for (const section of work.work_sections ?? []) {
    for (const block of section.content_blocks ?? []) {
      for (const image of block.block_images ?? []) {
        if (image.ai_generated && !image.ai_confirmed) n += 1;
      }
    }
  }
  return n;
}

export function aiUnconfirmedBySection(work: WorkDetail): string {
  const parts: string[] = [];
  for (const section of work.work_sections ?? []) {
    let n = 0;
    for (const block of section.content_blocks ?? []) {
      for (const image of block.block_images ?? []) {
        if (image.ai_generated && !image.ai_confirmed) n += 1;
      }
    }
    if (n > 0) {
      const name = section.headline?.ko?.trim() || "블록";
      parts.push(`${name} ${n}`);
    }
  }
  return parts.join(" · ");
}
