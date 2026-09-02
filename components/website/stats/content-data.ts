/**
 * 콘텐츠 화면 데이터 — website_stats 의 page·landing 행을 화면 모델로 옮긴다.
 *
 * summary-data.ts 와 같은 규칙이다. 값이 없으면 null·빈 배열로 두고 0 으로
 * 바꾸지 않는다. GA4 는 사이트 공개 전이라 아직 한 줄도 없다.
 *
 * 이 화면만의 일이 하나 더 있다. GA4 는 경로밖에 모르지만 우리는 워크·인사이트
 * 표를 갖고 있으니 slug 로 제목을 붙여 준다.
 *
 * ── GA4 리포트 (src/lib/google/ga4.ts 의 REPORTS)
 *   page             [date, pagePath]                              screenPageViews …
 *   landing          [date, landingPage]                         sessions · engagementRate
 *   scroll           [date, pagePath, percentScrolled]           eventCount
 *   landing_channel  [date, landingPage, sessionDefaultChannelGroup]  sessions · engagementRate
 *
 *   · 페이지별 이탈률 — page 리포트에 이탈·나감 지표가 없다. 진입한 세션 기준
 *     이탈만 landing 의 engagementRate 로 낼 수 있어 그것만 쓴다.
 *   · 다음 페이지 이동 — runReport 로 얻을 수 없다. 걷지 않는다.
 */

import {
  STATS_BAD,
  STATS_COLORS,
  STATS_MUTED,
  type StatsRow,
  type StatsScatterGroup,
  type StatsSlice
} from "@/components/website/stats/stats-chart";
import { clip, pickRows, shortDate } from "@/components/website/stats/stats-data";
import type { SankeyModel } from "@/components/website/stats/stats-sankey";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";

/** 콘텐츠 화면이 쓰는 kind. 한 번에 받아 온다 */
export const CONTENT_KINDS = ["page", "landing", "scroll", "landing_channel"];

type Rows = StatsPoint[];

/** 콘텐츠 화면은 GA4 의 이번 기간 값만 본다 */
function pick(bundle: StatsBundle | null, kind: string): Rows {
  return pickRows(bundle, kind, "ga4");
}

/* ─────────────────────────── 경로 읽기 ─────────────────────────── */

export type PageTypeId =
  | "work"
  | "list"
  | "home"
  | "insight"
  | "about"
  | "career"
  | "contact"
  | "etc";

type PageType = { id: PageTypeId; label: string; color: string };

/** 도넛·추이·막대가 모두 이 순서·이 색을 쓴다 */
export const PAGE_TYPES: PageType[] = [
  { id: "work", label: "워크 상세", color: STATS_COLORS[0] },
  { id: "list", label: "목록", color: "#7aa9e3" },
  { id: "home", label: "홈", color: STATS_COLORS[1] },
  { id: "insight", label: "인사이트 글", color: STATS_COLORS[2] },
  { id: "about", label: "회사 소개", color: STATS_COLORS[3] },
  { id: "career", label: "커리어", color: STATS_COLORS[4] },
  { id: "contact", label: "문의", color: STATS_MUTED },
  { id: "etc", label: "기타", color: "#c9ced6" }
];

const TYPE_BY_ID = new Map(PAGE_TYPES.map((type) => [type.id, type]));

/** 목록·상세가 아닌 고정 화면의 이름. 경로 그대로 보이지 않게 한다 */
const STATIC_NAME: Record<string, string> = {
  "/": "홈",
  "/works": "Works 목록",
  "/insight": "인사이트 목록",
  "/about": "About",
  "/expertise": "Expertise",
  "/career": "Career",
  "/contact": "Let's Talk",
  "/privacy": "개인정보 처리방침"
};

/** 물음표·우물정과 끝 빗금을 떼어 같은 페이지가 갈라지지 않게 한다 */
function normalizePath(raw: string | null): string | null {
  if (!raw) return null;
  let path = raw.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

/**
 * apollon-website 는 localePrefix 가 as-needed 다. 국문에는 접두어가 없고
 * 영문만 /en 으로 시작한다.
 */
function splitLocale(path: string): { locale: "ko" | "en"; route: string } {
  if (path === "/en") return { locale: "en", route: "/" };
  if (path.startsWith("/en/")) return { locale: "en", route: path.slice(3) };
  return { locale: "ko", route: path };
}

type Route = { typeId: PageTypeId; slug: string | null; name: string };

function readRoute(route: string): Route {
  const work = /^\/works\/(.+)$/.exec(route);
  if (work) return { typeId: "work", slug: work[1], name: work[1] };

  const insight = /^\/insight\/(.+)$/.exec(route);
  if (insight) return { typeId: "insight", slug: insight[1], name: insight[1] };

  const name = STATIC_NAME[route] ?? route;
  if (route === "/") return { typeId: "home", slug: null, name };
  if (route === "/works" || route === "/insight") return { typeId: "list", slug: null, name };
  if (route === "/about" || route === "/expertise") return { typeId: "about", slug: null, name };
  if (route === "/career") return { typeId: "career", slug: null, name };
  if (route === "/contact") return { typeId: "contact", slug: null, name };
  return { typeId: "etc", slug: null, name };
}

/* ─────────────────────── 제목 붙이기 ─────────────────────── */

/** slug → 제목. GA4 가 못 하는 일이라 이 화면의 핵심이다 */
export type TitleMap = {
  works: Map<string, string>;
  insights: Map<string, string>;
};

export const EMPTY_TITLES: TitleMap = { works: new Map(), insights: new Map() };

function titleOf(item: { slug: string; title: { ko?: string; en?: string } | null }): string {
  return item.title?.ko?.trim() || item.title?.en?.trim() || item.slug;
}

export function buildTitles(works: WorkListItem[], insights: InsightListItem[]): TitleMap {
  return {
    works: new Map(works.map((item) => [item.slug, titleOf(item)])),
    insights: new Map(insights.map((item) => [item.slug, titleOf(item)]))
  };
}

/**
 * GA4 경로를 화면 이름으로 바꾼다. 콘텐츠 화면과 같은 규칙이다.
 * 워크·인사이트는 titles 표에서 slug 로 찾고, 고정 화면은 STATIC_NAME 을 쓴다.
 */
export function pageTitleFromPath(raw: string, titles: TitleMap = EMPTY_TITLES): string {
  const path = normalizePath(raw);
  if (path === null) return raw;
  const { route } = splitLocale(path);
  const read = readRoute(route);
  if (read.slug === null) return read.name;
  if (read.typeId === "work") return titles.works.get(read.slug) ?? read.name;
  if (read.typeId === "insight") return titles.insights.get(read.slug) ?? read.name;
  return read.name;
}

/* ─────────────────────── 페이지 한 줄 ─────────────────────── */

export type ContentPage = {
  path: string;
  /** 워크·인사이트면 제목, 아니면 화면 이름 */
  title: string;
  typeId: PageTypeId;
  typeLabel: string;
  typeColor: string;
  locale: "ko" | "en";
  /** 조회 — page 리포트의 screenPageViews */
  views: number | null;
  /** 진입 — landing 리포트의 sessions */
  entries: number | null;
  /** 이탈률 0~1 — 진입한 세션 기준. 진입이 없으면 null */
  bounce: number | null;
};

type Accum = { views: number | null; entries: number | null; engaged: number; weight: number };

function bucket(map: Map<string, Accum>, path: string): Accum {
  let item = map.get(path);
  if (!item) {
    item = { views: null, entries: null, engaged: 0, weight: 0 };
    map.set(path, item);
  }
  return item;
}

/**
 * 페이지 한 장씩. page 로 조회를, landing 으로 진입과 이탈을 채운다.
 * 두 리포트 모두에 없는 값은 null 로 남는다.
 */
export function buildPages(bundle: StatsBundle | null, titles: TitleMap): ContentPage[] {
  const map = new Map<string, Accum>();

  for (const row of pick(bundle, "page")) {
    const path = normalizePath(row.key);
    if (path === null || typeof row.views !== "number") continue;
    const item = bucket(map, path);
    item.views = (item.views ?? 0) + row.views;
  }

  for (const row of pick(bundle, "landing")) {
    const path = normalizePath(row.key);
    if (path === null || typeof row.sessions !== "number") continue;
    const item = bucket(map, path);
    item.entries = (item.entries ?? 0) + row.sessions;
    // 참여율은 더하면 안 된다. 세션 수로 무게를 실어 평균한다
    if (typeof row.engagement_rate === "number" && row.sessions > 0) {
      item.engaged += row.engagement_rate * row.sessions;
      item.weight += row.sessions;
    }
  }

  const pages: ContentPage[] = [];
  for (const [path, item] of map) {
    const { locale, route } = splitLocale(path);
    const read = readRoute(route);
    const type = TYPE_BY_ID.get(read.typeId) ?? PAGE_TYPES[PAGE_TYPES.length - 1];
    const known =
      read.slug === null
        ? null
        : read.typeId === "work"
          ? (titles.works.get(read.slug) ?? null)
          : (titles.insights.get(read.slug) ?? null);

    pages.push({
      path,
      title: known ?? read.name,
      typeId: type.id,
      typeLabel: type.label,
      typeColor: type.color,
      locale,
      views: item.views,
      entries: item.entries,
      bounce: item.weight > 0 ? 1 - item.engaged / item.weight : null
    });
  }

  return pages.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
}

/* ─────────────────────── 1 페이지 종류별 ─────────────────────── */

/** 조회 비중 — 조회가 0 인 종류는 조각을 만들지 않는다 */
export function buildTypePie(pages: ContentPage[]): StatsSlice[] {
  const sum = new Map<PageTypeId, number>();
  for (const page of pages) {
    if (typeof page.views !== "number") continue;
    sum.set(page.typeId, (sum.get(page.typeId) ?? 0) + page.views);
  }

  return PAGE_TYPES.filter((type) => (sum.get(type.id) ?? 0) > 0).map((type) => ({
    name: type.label,
    value: sum.get(type.id) as number,
    color: type.color
  }));
}

export type SeriesSpec = { key: string; name: string; color: string };

/** 종류별 추이 — 날짜를 가로로, 페이지 종류를 계열로 편다 */
export function buildTypeTrend(bundle: StatsBundle | null): {
  rows: StatsRow[];
  series: SeriesSpec[];
} {
  const rows = pick(bundle, "page").filter((row) => typeof row.views === "number");
  if (rows.length === 0) return { rows: [], series: [] };

  const byDay = new Map<string, Map<PageTypeId, number>>();
  const seen = new Set<PageTypeId>();

  for (const row of rows) {
    const path = normalizePath(row.key);
    if (path === null) continue;
    const { typeId } = readRoute(splitLocale(path).route);
    seen.add(typeId);
    let day = byDay.get(row.date);
    if (!day) {
      day = new Map();
      byDay.set(row.date, day);
    }
    day.set(typeId, (day.get(typeId) ?? 0) + (row.views as number));
  }

  const series = PAGE_TYPES.filter((type) => seen.has(type.id)).map((type) => ({
    key: type.id,
    name: type.label,
    color: type.color
  }));

  const dates = [...byDay.keys()].sort();
  return {
    series,
    // 그날 다른 종류는 걷혔는데 이 종류만 없으면 진짜 0 이다
    rows: dates.map((date) => {
      const day = byDay.get(date) as Map<PageTypeId, number>;
      const out: StatsRow = { date: shortDate(date) };
      for (const spec of series) out[spec.key] = day.get(spec.key as PageTypeId) ?? 0;
      return out;
    })
  };
}

/* ─────────────────────── 2 모든 페이지 ─────────────────────── */

export type PageFilterId = "all" | "work" | "insight" | "about" | "career" | "contact";

export const PAGE_FILTERS: { id: PageFilterId; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "work", label: "워크" },
  { id: "insight", label: "인사이트" },
  { id: "about", label: "회사 소개" },
  { id: "career", label: "커리어" },
  { id: "contact", label: "문의" }
];

export type LocaleFilter = "all" | "ko" | "en";

export function filterPages(
  pages: ContentPage[],
  type: PageFilterId,
  locale: LocaleFilter
): ContentPage[] {
  return pages.filter((page) => {
    if (type !== "all" && page.typeId !== type) return false;
    if (locale !== "all" && page.locale !== locale) return false;
    return true;
  });
}

/** 가로 막대 — 조회가 있는 것만, 많은 순 열둘 */
export function buildPageBars(pages: ContentPage[]): {
  rows: StatsRow[];
  colors: string[];
} {
  const top = pages.filter((page) => (page.views ?? 0) > 0).slice(0, 12);
  return {
    rows: top.map((page) => ({ name: clip(page.title), value: page.views })),
    colors: top.map((page) => page.typeColor)
  };
}

/* ────────────────── 3 어디로 들어와 어디로 가나 ────────────────── */

/** GA4 기본 채널 그룹 — 영문 고정값이다 */
const CHANNEL_LABEL: Record<string, string> = {
  "Organic Search": "검색",
  Direct: "직접",
  Referral: "추천",
  "Organic Social": "SNS",
  "Paid Search": "유료 검색",
  Email: "이메일",
  Unassigned: "미분류"
};

function channelLabel(name: string): string {
  return CHANNEL_LABEL[name] ?? name;
}

function pageLabel(path: string, titles: TitleMap): string {
  const { route } = splitLocale(path);
  const read = readRoute(route);
  const known =
    read.slug === null
      ? null
      : read.typeId === "work"
        ? (titles.works.get(read.slug) ?? null)
        : (titles.insights.get(read.slug) ?? null);
  return clip(known ?? read.name, 28);
}

/**
 * 유입 경로 → 처음 본 페이지. landing_channel 의 key=landingPage, key2=채널.
 * 그다음 칸은 GA4 runReport 가 주지 않아 두 칸만 그린다.
 */
export function buildLandingFlow(
  bundle: StatsBundle | null,
  titles: TitleMap
): SankeyModel | null {
  const rows = pick(bundle, "landing_channel");
  if (rows.length === 0) return null;

  const pair = new Map<string, number>();
  const channelTotals = new Map<string, number>();
  const pageTotals = new Map<string, number>();

  for (const row of rows) {
    if (typeof row.sessions !== "number" || row.sessions <= 0) continue;
    const path = normalizePath(row.key);
    const channel = row.key2?.trim();
    if (!path || !channel) continue;

    const id = `${channel}\0${path}`;
    pair.set(id, (pair.get(id) ?? 0) + row.sessions);
    channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + row.sessions);
    pageTotals.set(path, (pageTotals.get(path) ?? 0) + row.sessions);
  }

  if (pair.size === 0) return null;

  const channels = [...channelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
  const pages = [...pageTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path]) => path);

  const channelSet = new Set(channels);
  const pageSet = new Set(pages);

  const links: SankeyModel["links"] = [];
  for (const [id, value] of pair) {
    const [channel, path] = id.split("\0");
    if (!channelSet.has(channel) || !pageSet.has(path)) continue;
    links.push({
      source: channels.indexOf(channel),
      target: channels.length + pages.indexOf(path),
      value
    });
  }

  if (links.length === 0) return null;

  return {
    nodes: [
      ...channels.map((name) => ({ name: channelLabel(name) })),
      ...pages.map((path) => ({ name: pageLabel(path, titles) }))
    ],
    links
  };
}

/* ─────────────────── 4 읽은 깊이 · 진입 대비 이탈 ─────────────────── */

const SCROLL_BUCKETS = ["25", "50", "75", "100"] as const;
const SCROLL_LABEL: Record<(typeof SCROLL_BUCKETS)[number], string> = {
  "25": "25%",
  "50": "50%",
  "75": "75%",
  "100": "100%"
};

/** GA4 향상된 측정은 25·50·75·90 을 준다. 90 은 100% 칸에 넣는다 */
function scrollBucket(raw: string | null): (typeof SCROLL_BUCKETS)[number] | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 90) return "100";
  if (n >= 75) return "75";
  if (n >= 50) return "50";
  if (n >= 25) return "25";
  return null;
}

/** 목업처럼 페이지 종류별(워크·인사이트 등)로 percentScrolled 를 묶는다 */
export function buildScrollDepth(bundle: StatsBundle | null): {
  rows: StatsRow[];
  series: SeriesSpec[];
} {
  const rows = pick(bundle, "scroll");
  if (rows.length === 0) return { rows: [], series: [] };

  const byType = new Map<PageTypeId, Map<string, number>>();

  for (const row of rows) {
    if (typeof row.events !== "number" || row.events <= 0) continue;
    const path = normalizePath(row.key);
    const bucket = scrollBucket(row.key2);
    if (!path || !bucket) continue;

    const { typeId } = readRoute(splitLocale(path).route);
    let day = byType.get(typeId);
    if (!day) {
      day = new Map();
      byType.set(typeId, day);
    }
    day.set(bucket, (day.get(bucket) ?? 0) + row.events);
  }

  const active = [...byType.entries()].filter(([, map]) => [...map.values()].some((v) => v > 0));
  if (active.length === 0) return { rows: [], series: [] };

  const series = active.slice(0, 4).map(([typeId]) => {
    const type = TYPE_BY_ID.get(typeId) ?? PAGE_TYPES[PAGE_TYPES.length - 1];
    const short =
      type.id === "work" ? "워크" : type.id === "insight" ? "인사이트" : type.label;
    return { key: typeId, name: short, color: type.color };
  });

  const chartRows: StatsRow[] = [];
  for (const bucket of SCROLL_BUCKETS) {
    const out: StatsRow = { label: SCROLL_LABEL[bucket] };
    let seen = false;
    for (const spec of series) {
      const value = byType.get(spec.key as PageTypeId)?.get(bucket);
      if (typeof value === "number" && value > 0) {
        out[spec.key] = value;
        seen = true;
      }
    }
    if (seen) chartRows.push(out);
  }

  return { rows: chartRows, series };
}

/* ─────────────────── 진입 대비 이탈 (거품) ─────────────────── */

/** 가로 진입 · 세로 이탈률(%) · 원 크기 조회. 셋이 다 있어야 점을 찍는다 */
export function buildEntryBubble(pages: ContentPage[]): StatsScatterGroup[] {
  return pages
    .filter(
      (page) =>
        typeof page.entries === "number" &&
        page.entries > 0 &&
        typeof page.bounce === "number" &&
        typeof page.views === "number"
    )
    .slice(0, 8)
    .map((page) => ({
      name: page.title,
      color: page.typeColor,
      points: [
        {
          x: page.entries as number,
          y: Math.round((page.bounce as number) * 100),
          z: page.views as number
        }
      ]
    }));
}

/* ─────────────────────── 5 채워야 할 것 ─────────────────────── */

/**
 * 통계가 아니다. works·insights 를 직접 읽어 비어 있는 항목을 센다.
 * 세는 항목은 check_works·check_insights 보기에 있는 것으로 한정한다.
 * 국문 한 줄 요약은 두 보기 모두 검사 칸이 없어 셀 수 없다.
 */
const FILL_FLAGS = [
  "missing_key_alt",
  "missing_image_alt",
  "missing_summary_en",
  "ai_unconfirmed"
] as const;

export const FILL_LABELS = ["대표 이미지 대체 텍스트", "본문 이미지 대체 텍스트", "영문 한 줄 요약", "AI 확인"];

export const FILL_TOTAL = FILL_FLAGS.length;

export const FILL_SERIES = [
  { key: "filled", name: "채워짐", color: STATS_COLORS[2] },
  { key: "empty", name: "비어 있음", color: STATS_BAD }
];

type Checkable = {
  slug: string;
  title: { ko?: string; en?: string } | null;
  check: Partial<Record<(typeof FILL_FLAGS)[number], boolean>> | null;
};

/** 비어 있는 항목이 하나라도 있는 것만, 많이 빈 순으로 */
export function buildFill(works: Checkable[], insights: Checkable[]): StatsRow[] {
  const rows: { name: string; empty: number }[] = [];

  for (const item of [...works, ...insights]) {
    if (!item.check) continue;
    let empty = 0;
    for (const flag of FILL_FLAGS) if (item.check[flag]) empty += 1;
    if (empty === 0) continue;
    rows.push({ name: titleOf(item), empty });
  }

  return rows
    .sort((a, b) => b.empty - a.empty)
    .slice(0, 10)
    .map((row) => ({ name: clip(row.name), filled: FILL_TOTAL - row.empty, empty: row.empty }));
}

