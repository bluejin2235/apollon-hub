export const WIKI_CATEGORIES = ["forms", "standards", "rules"] as const;
export type WikiCategory = (typeof WIKI_CATEGORIES)[number];

export type WikiRelatedKind = "doc" | "term";

export type WikiRelated = {
  kind: WikiRelatedKind;
  title: string;
  category?: WikiCategory;
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
};

export type WikiDoc = {
  slug: string;
  title: string;
  category: WikiCategory;
  kind: string;
  summary: string;
  content: string;
  sections: WikiSection[];
  related: WikiRelated[];
  use_count: number;
  version: number;
  is_active: boolean;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  history: WikiHistoryEntry[];
};

export type WikiDocListItem = {
  slug: string;
  title: string;
  category: WikiCategory;
  kind: string;
  summary: string;
  is_active: boolean;
  updated_at: string | null;
  updated_by_name: string | null;
};

export const WIKI_KIND_OPTIONS: Record<
  WikiCategory,
  ReadonlyArray<{ value: string; label: string }>
> = {
  forms: [
    { value: "template", label: "문서 양식" },
    { value: "checklist", label: "체크리스트" }
  ],
  standards: [
    { value: "analysis", label: "분석기준" },
    { value: "tone", label: "톤가이드" }
  ],
  rules: [{ value: "policy", label: "규정" }]
};

export const WIKI_CATEGORY_META: Record<
  WikiCategory,
  { label: string; path: string; blurb: string; anyoneEdits: boolean }
> = {
  forms: {
    label: "양식",
    path: "/wiki/forms",
    blurb: "문서를 만들 때 꺼내 쓰는 뼈대. 루나가 「만들기」 요청에 이걸 씁니다 · 누구나 고칠 수 있어요",
    anyoneEdits: true
  },
  standards: {
    label: "기준",
    path: "/wiki/standards",
    blurb: "일할 때 맞춰 보는 기준. 루나가 분석·작성에 이걸 씁니다 · 누구나 고칠 수 있어요",
    anyoneEdits: true
  },
  rules: {
    label: "규정",
    path: "/wiki/rules",
    blurb: "아폴론이 지키는 규칙. 바뀌면 전원에게 알림이 갑니다",
    anyoneEdits: false
  }
};

export function isWikiCategory(value: string): value is WikiCategory {
  return (WIKI_CATEGORIES as readonly string[]).includes(value);
}

export function wikiKindLabel(category: WikiCategory, kind: string): string {
  return (
    WIKI_KIND_OPTIONS[category].find((k) => k.value === kind)?.label ?? kind
  );
}

export function inferWikiCategory(kind: string, slug?: string): WikiCategory {
  if (slug === "rfp_analysis") return "standards";
  if (kind === "analysis" || kind === "tone") return "standards";
  if (kind === "policy") return "rules";
  return "forms";
}

export function wikiDocPath(category: WikiCategory, slug: string): string {
  return `/wiki/${category}/${encodeURIComponent(slug)}`;
}

export function wikiMakePrompt(title: string): string {
  return `「${title}」 양식으로 만들어줘`;
}

export const WIKI_SLUG_RE = /^[a-z][a-z0-9_-]{1,48}$/;

export function makeWikiSlug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (WIKI_SLUG_RE.test(ascii)) return ascii;
  return `d${Date.now().toString(36)}`;
}
