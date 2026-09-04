export type HomeCardLayout = "big" | "small";
export type HomeTargetType = "work" | "insight";

export type HomeContent = {
  type: "work" | "insight";
  title: { ko?: string; en?: string };
  slug: string;
  thumbnail: string | null;
  kind: string;
  meta: string;
};

export type HomeItem = {
  type: HomeTargetType;
  id: string;
  pinned: boolean;
  pin_sort: number | null;
  layout: HomeCardLayout;
  published_at: string | null;
  content: HomeContent;
};

export type HomeList = {
  items: HomeItem[];
  unpublished: boolean;
};

export type HomeWrite = {
  type: HomeTargetType;
  id: string;
  pinned: boolean;
  pin_sort: number | null;
  layout: HomeCardLayout;
};

export function homeTitle(item: { title?: { ko?: string; en?: string } | null; slug?: string | null }) {
  return item.title?.ko?.trim() || item.title?.en?.trim() || item.slug || "";
}

export type HomeRow =
  | { kind: "big"; item: HomeItem }
  | { kind: "small"; items: HomeItem[]; orphan: boolean };

export function groupHomeRows(items: HomeItem[]): HomeRow[] {
  const rows: HomeRow[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.layout === "big") {
      rows.push({ kind: "big", item: cur });
      i += 1;
      continue;
    }
    const next = items[i + 1];
    if (next && next.layout === "small") {
      rows.push({ kind: "small", items: [cur, next], orphan: false });
      i += 2;
    } else {
      rows.push({ kind: "small", items: [cur], orphan: true });
      i += 1;
    }
  }
  return rows;
}

export function homeItemKey(item: Pick<HomeItem, "type" | "id">) {
  return `${item.type}:${item.id}`;
}

/** 예전 칸 고르기. 자동 피드에서는 쓰지 않는다. */
export type HomeLayout = "wide" | "grid";
export type HomeTargetTypeLegacy = "work" | "insight" | "page" | "custom";

export type HomeCandidate = {
  target_type: "work" | "insight";
  work_id: string | null;
  insight_id: string | null;
  title: { ko?: string; en?: string } | null;
  slug: string;
  thumbnail: string | null;
  published_at: string | null;
  kind: string;
  meta: string;
};

export type HomeCandidateList = {
  items: HomeCandidate[];
};

export type HomeSlot = {
  id: string;
  sort: number;
  layout: HomeLayout;
  target_type: HomeTargetTypeLegacy;
  work_id: string | null;
  insight_id: string | null;
  page_key: string | null;
  custom_title: string | null;
  custom_subtitle: string | null;
  custom_image: string | null;
  custom_video: string | null;
  custom_href: string | null;
  status: "draft" | "published";
  content: HomeContent | null;
};

