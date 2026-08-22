import type { LunaCard } from "@/lib/luna/tavily";
import type { NotionSource } from "@/lib/luna/notion";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import {
  buildSourcePacks,
  countSourcePackMaterials,
  tierSourcePacks,
  type SourcePackItem,
  type SourcePackView
} from "@/lib/luna/source-pack";
import {
  MEDIA_PACK_MID,
  hasImageSearchIntent
} from "@/lib/luna/media-index-search";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";

export type LunaProgressStepLite = {
  key: string;
  label: string;
  status: "running" | "done" | "skip";
  ms?: number;
};

export type LunaAnswerTab = "all" | "docs" | "images" | "video";

export type LunaSearchCounts = {
  wiki: number | null;
  notion: number | null;
  work: number | null;
  image: number | null;
};

export function docCards(cards: LunaCard[] | null | undefined): LunaCard[] {
  return (cards ?? []).filter((c) => c.type !== "image");
}

export function imageCards(cards: LunaCard[] | null | undefined): LunaCard[] {
  return (cards ?? [])
    .filter((c) => c.type === "image")
    .filter((c) => (c.similarity ?? 0) >= MEDIA_PACK_MID)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
}

export function flattenPackItems(views: SourcePackView[]): SourcePackItem[] {
  const items: SourcePackItem[] = [];
  for (const v of views) {
    if (v.kind === "item") items.push(v);
    else items.push(...v.children);
  }
  return items.filter((i) => !i.id.startsWith("image:"));
}

export function buildDocPackItems(
  notionSources: NotionSource[] | null | undefined,
  cards: LunaCard[] | null | undefined,
  question?: string | null
): SourcePackItem[] {
  const views = buildSourcePacks(notionSources, docCards(cards), question);
  const tiers = tierSourcePacks(views);
  const docViews = views.map((v) => {
    if (v.kind === "project") {
      return {
        ...v,
        children: v.children.filter((c) => !c.id.startsWith("image:"))
      };
    }
    return v;
  });
  const ordered: SourcePackItem[] = [];
  if (tiers.recommended && !tiers.recommended.id.startsWith("image:")) {
    ordered.push(tiers.recommended);
  }
  for (const m of tiers.mid) {
    if (!m.id.startsWith("image:")) ordered.push(m);
  }
  for (const w of tiers.weak) {
    if (!w.id.startsWith("image:")) ordered.push(w);
  }
  if (ordered.length === 0) {
    return flattenPackItems(docViews);
  }
  return ordered;
}

export function countDocMaterials(
  notionSources: NotionSource[] | null | undefined,
  cards: LunaCard[] | null | undefined
): number {
  return countSourcePackMaterials(
    buildSourcePacks(notionSources, docCards(cards))
  );
}

export function resolveSearchCounts(opts: {
  snapshot?: LunaSearchCounts | null;
  notionSources?: NotionSource[] | null;
  wikiSources?: WikiSourceRef[] | null;
  cards?: LunaCard[] | null;
  searchDone?: boolean;
}): LunaSearchCounts {
  if (opts.snapshot) return opts.snapshot;
  const resolved = opts.searchDone === true;
  return {
    wiki: resolved ? (opts.wikiSources?.length ?? 0) : null,
    notion: resolved ? (opts.notionSources?.length ?? 0) : null,
    work: resolved
      ? (opts.cards ?? []).filter((c) => c.type === "nas").length
      : null,
    image: resolved ? imageCards(opts.cards).length : null
  };
}

export type LunaProgressRow = {
  key: string;
  state: "done" | "now" | "wait";
  label: string;
  sub?: string;
  ms?: number;
};

export function buildProgressRows(opts: {
  steps: LunaProgressStepLite[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  isComplete: boolean;
}): LunaProgressRow[] {
  const { steps, classification, counts, isComplete } = opts;
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const classify = byKey.get("classify");
  const search = byKey.get("search");
  const evalStep = byKey.get("eval");
  const answer = byKey.get("answer");

  const typeLabel =
    classification?.labels?.filter(Boolean).join(" · ") ||
    classification?.types?.join(" · ") ||
    classify?.label ||
    "";

  const rows: LunaProgressRow[] = [];

  rows.push({
    key: "understand",
    state: classify?.status === "done" ? "done" : classify ? "now" : "wait",
    label: "질문을 이해했어요",
    sub: typeLabel || undefined,
    ms: classify?.ms
  });

  const foundParts: string[] = [];
  if (counts.wiki != null) foundParts.push(`위키 ${counts.wiki}`);
  if (counts.notion != null) foundParts.push(`노션 ${counts.notion}`);
  if (counts.work != null) foundParts.push(`Work ${counts.work}`);
  if (counts.image != null) foundParts.push(`이미지 ${counts.image}`);

  const foundReady =
    search?.status === "done" ||
    counts.wiki != null ||
    counts.notion != null ||
    counts.work != null ||
    counts.image != null;

  rows.push({
    key: "found",
    state: foundReady ? "done" : search?.status === "running" ? "now" : "wait",
    label: foundReady
      ? foundParts.length > 0
        ? foundParts.join(" · ")
        : "검색 결과 없음"
      : "자료 검색 중",
    ms: search?.ms
  });

  const docTotal = Math.max(
    1,
    (counts.notion ?? 0) +
      (counts.work ?? 0) +
      Math.min(counts.image ?? 0, 6)
  );
  let readCurrent = 0;
  let readState: LunaProgressRow["state"] = "wait";
  if (evalStep?.status === "running") {
    readState = "now";
    readCurrent = Math.max(1, Math.ceil(docTotal / 2));
  } else if (evalStep?.status === "done" && answer?.status === "running") {
    readState = "now";
    readCurrent = Math.max(1, docTotal - 1);
  } else if (answer?.status === "done" || isComplete) {
    readState = "done";
    readCurrent = docTotal;
  } else if (evalStep?.status === "done") {
    readState = "done";
    readCurrent = docTotal;
  }

  rows.push({
    key: "reading",
    state: readState,
    label: "자료를 읽는 중",
    sub:
      readState === "wait"
        ? undefined
        : `${docTotal}건 중 ${readCurrent}건째`,
    ms: evalStep?.ms
  });

  rows.push({
    key: "answer",
    state:
      answer?.status === "done" || isComplete
        ? "done"
        : answer?.status === "running"
          ? "now"
          : "wait",
    label: "답변 정리",
    ms: answer?.ms
  });

  return rows;
}

export function progressSummary(counts: LunaSearchCounts): string {
  const parts: string[] = [];
  if (counts.wiki != null) parts.push(`위키 ${counts.wiki}`);
  if (counts.notion != null) parts.push(`노션 ${counts.notion}`);
  if (counts.work != null) parts.push(`Work ${counts.work}`);
  if (counts.image != null) parts.push(`이미지 ${counts.image}`);
  return parts.length > 0 ? parts.join(" · ") : "검색 중";
}

export function showVideoTab(imageCount: number | null): boolean {
  return imageCount != null && imageCount > 0;
}

export function showImageIndexWarning(
  question: string | null | undefined,
  imageCount: number,
  docCount: number
): boolean {
  return (
    Boolean(question && hasImageSearchIntent(question)) &&
    imageCount === 0 &&
    docCount > 0
  );
}

export function imageCategoryBadge(
  cat: string | undefined
): { label: string; className: string } | null {
  if (cat === "ours") {
    return { label: "시안", className: "bg-[rgba(46,111,168,.9)]" };
  }
  if (cat === "reference") {
    return { label: "레퍼", className: "bg-[rgba(139,109,63,.9)]" };
  }
  if (cat === "document") {
    return { label: "문서", className: "bg-[rgba(91,100,114,.9)]" };
  }
  return null;
}

export function imagePathCaption(rawPath: string | undefined): string {
  if (!rawPath) return "";
  const parts = rawPath.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(-3, -1).join("\\") || parts.slice(0, -1).join("\\");
}
