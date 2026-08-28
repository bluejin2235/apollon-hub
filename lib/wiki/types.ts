export type WikiMenuEditableBy = "all" | "admin";

export type WikiMenu = {
  slug: string;
  name: string;
  description: string;
  editable_by: WikiMenuEditableBy;
  sort_order: number;
  is_active: boolean;
  doc_count?: number;
};

export type WikiRelatedKind = "doc" | "term";

export type WikiRelated = {
  kind: WikiRelatedKind;
  title: string;
  menu_slug?: string;
  slug?: string;
};

export type WikiSection = {
  id: string;
  title: string;
  body: string;
};

export type WikiHistoryEntry = {
  version: number;
  at: string;
  by: string | null;
  by_name: string;
  summary: string;
  added: number;
  removed: number;
  title: string;
  kind: string;
  summary_text: string;
  related: WikiRelated[];
  sections: WikiSection[];
  menu_slug?: string;
};

export type WikiDoc = {
  /** luna_library.id — 임베딩 조인용. 구스키마면 없을 수 있다. */
  id?: string | null;
  slug: string;
  title: string;
  menu_slug: string;
  kind: string;
  summary: string;
  content: string;
  sections: WikiSection[];
  related: WikiRelated[];
  use_count: number;
  version: number;
  is_active: boolean;
  visible_to_staff: boolean;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  history: WikiHistoryEntry[];
};

export type WikiDocListItem = {
  slug: string;
  title: string;
  menu_slug: string;
  kind: string;
  summary: string;
  is_active: boolean;
  visible_to_staff: boolean;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
};

/** 문서 slug 로 쓸 수 없는 경로 조각 */
export const WIKI_RESERVED_SLUGS = new Set([
  "terms",
  "list",
  "new",
  "menus",
  "forms",
  "standards",
  "rules"
]);

export const WIKI_OLD_CATEGORY_TO_LIST: Record<string, string> = {
  forms: "projects",
  standards: "workflow",
  rules: "rules"
};

export const WIKI_SLUG_RE = /^[a-z][a-z0-9-]{1,48}$/;

const WIKI_SLUG_MAP: Record<string, string> = {
  "project-gwangan-kcc-switzen": "gwangan-kcc-switzen",
  project_gwangan_kcc_switzen: "gwangan-kcc-switzen",
  "media-architecture-business": "media-architecture",
  media_architecture_business: "media-architecture",
  rfp_analysis: "rfp-analysis",
  ai_masterplan: "ai-masterplan"
};

/** 밑줄→하이픈, project-/business- 접두어 제거, 지정 매핑 */
export function wikiCanonicalSlug(old: string): string {
  const s = old.trim().toLowerCase();
  if (!s) return s;
  if (WIKI_SLUG_MAP[s]) return WIKI_SLUG_MAP[s];
  return s.replace(/_/g, "-").replace(/^project-/, "").replace(/^business-/, "");
}

export function wikiSlugLookupKeys(input: string): string[] {
  const raw = input.trim();
  if (!raw) return [];
  const can = wikiCanonicalSlug(raw);
  const keys = [
    raw,
    can,
    raw.replace(/-/g, "_"),
    can.replace(/-/g, "_"),
    `project-${can}`,
    `business-${can}`,
    `${can}-business`
  ];
  return [...new Set(keys.filter(Boolean))];
}

export const WIKI_MENU_SLUGS = [
  "projects",
  "business",
  "workflow",
  "identity",
  "rules"
] as const;

export type WikiMenuSlug = (typeof WIKI_MENU_SLUGS)[number];

/** 제목·옛 category 로 메뉴를 고른다. 본문은 건드리지 않는다. */
export function inferWikiMenuSlug(
  title: string,
  rawMenu: string,
  kind = ""
): string {
  const raw = rawMenu.trim();
  if ((WIKI_MENU_SLUGS as readonly string[]).includes(raw)) return raw;
  const t = title;
  if (
    /광안리|KCC 스위첸|스위첸|북한강|스타벅스|아시아미디어|아시아 미디어|LUNAR|스타에비뉴|트렌디|유스타운/i.test(
      t
    )
  ) {
    return "projects";
  }
  if (
    /미디어 아키텍처|미디어아키텍처|미디어 스페이스|미디어스페이스|미디어 조형|미디어조형|미디어 콘텐츠|미디어콘텐츠/i.test(
      t
    )
  ) {
    return "business";
  }
  if (/견적|계약|RFP|마스터플랜|마스터 플랜/i.test(t)) return "workflow";
  if (/정체성|아폴론이 누구/i.test(t)) return "identity";
  if (/근태|연차|임금|경비|복지|정보보안|정보 보안|괴롭힘/i.test(t)) {
    return "rules";
  }
  if (raw === "standards") return "workflow";
  if (raw === "forms" || raw === "form") return "projects";
  if (raw === "rules") return "rules";
  return "projects";
}

/** DB menu_slug 가 있으면 그대로 쓴다. 없을 때만 옛 category·제목으로 추론한다. */
export function resolveWikiDocMenuSlug(input: {
  title: string;
  menu_slug?: string;
  category?: string;
  kind?: string;
}): string {
  const explicit = (input.menu_slug ?? "").trim();
  if (explicit) return explicit;
  return inferWikiMenuSlug(
    input.title,
    (input.category ?? "").trim(),
    input.kind ?? ""
  );
}

export const WIKI_SEED_MENUS: WikiMenu[] = [
  {
    slug: "projects",
    name: "프로젝트 사례",
    description: "우리가 한 일. 무엇을 만들었고 무엇을 배웠나",
    editable_by: "all",
    sort_order: 10,
    is_active: true
  },
  {
    slug: "business",
    name: "사업 영역",
    description: "아폴론이 하는 일의 범위",
    editable_by: "all",
    sort_order: 20,
    is_active: true
  },
  {
    slug: "workflow",
    name: "일하는 방식",
    description: "견적·계약·분석처럼 반복하는 방법",
    editable_by: "all",
    sort_order: 30,
    is_active: true
  },
  {
    slug: "identity",
    name: "회사 기준",
    description: "우리가 누구이고 무엇을 지키는가",
    editable_by: "all",
    sort_order: 40,
    is_active: true
  },
  {
    slug: "rules",
    name: "인사·규정",
    description: "아폴론이 지키는 규칙. 바뀌면 전원에게 알림이 갑니다",
    editable_by: "admin",
    sort_order: 50,
    is_active: true
  }
];

export function makeWikiSlug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (WIKI_SLUG_RE.test(ascii) && !WIKI_RESERVED_SLUGS.has(ascii)) return ascii;
  return `d${Date.now().toString(36)}`;
}

export function wikiDocPath(slug: string): string {
  return `/wiki/${encodeURIComponent(wikiCanonicalSlug(slug))}`;
}

export function wikiListPath(menuSlug: string): string {
  return `/wiki/list/${encodeURIComponent(menuSlug)}`;
}

export function wikiMakePrompt(title: string): string {
  return `「${title}」 양식으로 만들어줘`;
}

export function menuAnyoneEdits(menu: WikiMenu | null | undefined): boolean {
  return menu?.editable_by !== "admin";
}
