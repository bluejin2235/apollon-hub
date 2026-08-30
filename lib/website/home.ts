export type HomeLayout = "wide" | "grid";
export type HomeTargetType = "work" | "insight" | "page" | "custom";

export type HomeContent = {
  type: "work" | "insight" | "custom";
  title: { ko?: string; en?: string };
  slug: string;
  thumbnail: string | null;
  kind: string;
  meta: string;
};

export type HomeSlot = {
  id: string;
  sort: number;
  layout: HomeLayout;
  target_type: HomeTargetType;
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

export type HomeList = {
  items: HomeSlot[];
};

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

export function homeTitle(item: { title?: { ko?: string; en?: string } | null; slug?: string | null }) {
  return item.title?.ko?.trim() || item.title?.en?.trim() || item.slug || "";
}

export type HomeRow =
  | { kind: "wide"; item: HomeSlot }
  | { kind: "grid"; items: HomeSlot[]; orphan: boolean };

export function groupHomeRows(items: HomeSlot[]): HomeRow[] {
  const rows: HomeRow[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.layout === "wide") {
      rows.push({ kind: "wide", item: cur });
      i += 1;
      continue;
    }
    const next = items[i + 1];
    if (next && next.layout === "grid") {
      rows.push({ kind: "grid", items: [cur, next], orphan: false });
      i += 2;
    } else {
      rows.push({ kind: "grid", items: [cur], orphan: true });
      i += 1;
    }
  }
  return rows;
}
