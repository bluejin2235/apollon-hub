/**
 * 검색 화면이 쓰는 값 만들기.
 *
 * 이 화면만 사정이 다르다. 다른 화면은 그릴 값이 아직 없지만 여기는 옛 사이트의
 * 검색 성과가 website_stats_baseline 에 남아 있다. 그래서 두 갈래를 끝까지
 * 갈라 둔다.
 *
 *   새 사이트  website_stats 의 gsc — current·previous. 지금은 0행
 *   옛 사이트  website_stats_baseline — baseline·baseline_overall
 *
 * 섞으면 옛 실적이 지금 실적처럼 보인다. 한 그래프 안에 같이 두지 않는다.
 */

import {
  STATS_COLORS,
  STATS_MUTED,
  STATS_TEXT,
  type StatsRow,
  type StatsScatterGroup,
  type StatsSlice
} from "@/components/website/stats/stats-chart";
import {
  byDate,
  clip,
  intText,
  makeDelta,
  numText,
  pctText,
  pickRows,
  ranked,
  shortDate,
  sumByKey,
  sumField,
  weightedField,
  type DeltaTone
} from "@/components/website/stats/stats-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

/** 검색 화면이 쓰는 kind. 한 번에 받아 온다 */
export const SEARCH_KINDS = ["daily", "query", "country", "device", "page"];

/**
 * 어느 사이트의 값인가.
 *   live    지금 사이트 — website_stats
 *   legacy  옛 사이트 — website_stats_baseline
 */
export type SearchSide = "live" | "legacy";

/** 새 사이트는 기간으로 자른 값, 옛 사이트는 날짜가 있는 baseline 행 */
function dailyRows(bundle: StatsBundle | null, side: SearchSide): StatsPoint[] {
  return side === "live"
    ? pickRows(bundle, "daily", "gsc", "current")
    : pickRows(bundle, "daily", "gsc", "baseline");
}

/**
 * 옛 사이트의 검색어·국가·기기·페이지는 날짜가 없다. 전체 기간 합계로 한 번에
 * 들어와 있어 기간으로 자를 수 없다. 기간 안의 값과 섞지 않도록 따로 읽는다.
 */
function overallRows(bundle: StatsBundle | null, kind: string): StatsPoint[] {
  return pickRows(bundle, kind, "gsc", "baseline_overall");
}

/** 옛 사이트 일별 값이 실제로 걸린 날짜 범위. 도장 문구에 쓴다 */
export function legacyRange(bundle: StatsBundle | null): { from: string; to: string } | null {
  const rows = dailyRows(bundle, "legacy").filter((row) => row.date);
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(byDate);
  return { from: sorted[0].date, to: sorted[sorted.length - 1].date };
}

/* ─────────────────────── 1. 전체 KPI ─────────────────────── */

export type SearchKpi = {
  id: string;
  label: string;
  value: string;
  sub: string;
  delta: string | null;
  tone: DeltaTone;
};

function ctrOf(rows: StatsPoint[]): number | null {
  const clicks = sumField(rows, "clicks");
  const impressions = sumField(rows, "impressions");
  if (clicks == null || impressions == null || impressions === 0) return null;
  return clicks / impressions;
}

/**
 * 노출·클릭·클릭률·평균 순위.
 *
 * 옛 사이트는 지난 기간 값을 받아 오지 않는다. 조회 계층이 baseline 을 이번
 * 기간만 읽기 때문이다. 그래서 변화 줄이 비어 있다. 지어내지 않는다.
 */
export function buildSearchKpis(bundle: StatsBundle | null, side: SearchSide): SearchKpi[] {
  const cur = dailyRows(bundle, side);
  const prev = side === "live" ? pickRows(bundle, "daily", "gsc", "previous") : [];

  const curImp = sumField(cur, "impressions");
  const curClick = sumField(cur, "clicks");
  const curCtr = ctrOf(cur);
  const curPos = weightedField(cur, "position", "impressions");

  const prevImp = sumField(prev, "impressions");
  const prevClick = sumField(prev, "clicks");
  const prevCtr = ctrOf(prev);
  const prevPos = weightedField(prev, "position", "impressions");

  return [
    {
      id: "impressions",
      label: "노출",
      value: intText(curImp) ?? "—",
      sub: "구글 결과에 보인 횟수",
      ...makeDelta(curImp, prevImp, "ratio", true)
    },
    {
      id: "clicks",
      label: "클릭",
      value: intText(curClick) ?? "—",
      sub: "그중 눌린 횟수",
      ...makeDelta(curClick, prevClick, "ratio", true)
    },
    {
      id: "ctr",
      label: "클릭률",
      value: pctText(curCtr, 1) ?? "—",
      sub: "보통 2~5%",
      ...makeDelta(curCtr, prevCtr, "point", true)
    },
    {
      id: "position",
      label: "평균 순위",
      value: numText(curPos, 1) ?? "—",
      sub: "1쪽은 10위까지",
      // 순위는 작을수록 좋다. 내려가면 파란색이 되어야 한다
      ...makeDelta(curPos, prevPos, "abs", false)
    }
  ];
}

/* ─────────────────────── 2. 노출과 클릭 추이 ─────────────────────── */

/** 막대는 노출, 선은 클릭. 두 값의 크기가 스무 배쯤 차이 나 축을 나눈다 */
export function buildSearchTrend(bundle: StatsBundle | null, side: SearchSide): StatsRow[] {
  return [...dailyRows(bundle, side)].sort(byDate).map((row) => ({
    date: shortDate(row.date),
    impressions: row.impressions,
    clicks: row.clicks
  }));
}

/* ─────────────────────── 3. 순위 분포 ─────────────────────── */

const RANK_BUCKETS: { label: string; below: number; color: string }[] = [
  { label: "1~3위", below: 3.5, color: STATS_COLORS[2] },
  { label: "4~10위", below: 10.5, color: STATS_COLORS[0] },
  { label: "11~20위", below: 20.5, color: STATS_COLORS[3] },
  { label: "21위 밖", below: Number.POSITIVE_INFINITY, color: STATS_MUTED }
];

export const RANK_COLORS = RANK_BUCKETS.map((bucket) => bucket.color);

/** 검색어를 평균 순위로 나눠 몇 개씩인지 센다 */
export function buildRankSpread(bundle: StatsBundle | null): StatsRow[] {
  const rows = overallRows(bundle, "query").filter(
    (row) => typeof row.position === "number"
  );
  if (rows.length === 0) return [];

  const counts = RANK_BUCKETS.map(() => 0);
  for (const row of rows) {
    const index = RANK_BUCKETS.findIndex((bucket) => (row.position as number) < bucket.below);
    counts[index === -1 ? RANK_BUCKETS.length - 1 : index] += 1;
  }

  return RANK_BUCKETS.map((bucket, index) => ({
    name: bucket.label,
    value: counts[index]
  }));
}

/* ─────────────────────── 4. 회사 이름 대 일반 ─────────────────────── */

/**
 * 회사 이름으로 검색해 들어온 사람은 이미 우리를 안다. 새 사람이 오는지 보려면
 * 회사 이름이 아닌 검색어를 따로 세어야 한다. 이 화면의 핵심이다.
 *
 * 검색어에는 오타·띄어쓰기·특수문자가 섞인다(appolon · apo_llon_art_ · 아폴롬).
 * 글자만 남기고 견준다.
 */
const BRAND_RE = /(apol|appol|아폴|immersiveworks|이머시브웍스)/;

export function isBrandQuery(query: string): boolean {
  return BRAND_RE.test(query.toLowerCase().replace(/[^a-z0-9가-힣]/g, ""));
}

export type QueryGroup = "brand" | "generic";

export const QUERY_GROUP_LABEL: Record<QueryGroup, string> = {
  brand: "회사 이름",
  generic: "일반 검색어"
};

/** 회사 이름은 회색, 일반은 파란색. 목업과 같다 */
export const QUERY_GROUP_COLOR: Record<QueryGroup, string> = {
  brand: STATS_MUTED,
  generic: STATS_COLORS[0]
};

function groupOf(query: string): QueryGroup {
  return isBrandQuery(query) ? "brand" : "generic";
}

export type BrandSplit = {
  /** 100% 로 채운 가로 막대. 노출 한 줄, 클릭 한 줄 */
  rows: StatsRow[];
  /** 막대 아래에 실제 숫자를 적는다. 비율만 보면 규모를 놓친다 */
  counts: { label: string; brand: string; generic: string }[];
};

/**
 * 옛 사이트 검색어에는 날짜가 없다. 목업처럼 달별로 쌓을 수 없어 전체 합계를
 * 비율로 보인다. 「일반이 늘어야 한다」는 흐름은 새 사이트 값이 쌓여야 보인다.
 */
export function buildBrandSplit(bundle: StatsBundle | null): BrandSplit {
  const rows = overallRows(bundle, "query");
  if (rows.length === 0) return { rows: [], counts: [] };

  const acc = {
    impressions: { brand: 0, generic: 0 },
    clicks: { brand: 0, generic: 0 }
  };

  for (const row of rows) {
    const group = groupOf(row.key ?? "");
    if (typeof row.impressions === "number") acc.impressions[group] += row.impressions;
    if (typeof row.clicks === "number") acc.clicks[group] += row.clicks;
  }

  const share = (label: string, part: { brand: number; generic: number }): StatsRow | null => {
    const total = part.brand + part.generic;
    if (total === 0) return null;
    return {
      name: label,
      brand: (part.brand / total) * 100,
      generic: (part.generic / total) * 100
    };
  };

  const bars = [share("노출", acc.impressions), share("클릭", acc.clicks)].filter(
    (row): row is StatsRow => row !== null
  );

  return {
    rows: bars,
    counts: [
      {
        label: "노출",
        brand: intText(acc.impressions.brand) ?? "—",
        generic: intText(acc.impressions.generic) ?? "—"
      },
      {
        label: "클릭",
        brand: intText(acc.clicks.brand) ?? "—",
        generic: intText(acc.clicks.generic) ?? "—"
      }
    ]
  };
}

/* ─────────────────────── 5. 검색어 지도 ─────────────────────── */

/**
 * 가로가 평균 순위, 세로가 노출, 원 크기가 클릭.
 * 검색어마다 계열을 만들면 범례가 수십 줄이 된다. 회사 이름과 일반 두 갈래로만
 * 나눈다. 이 화면이 답해야 할 물음이 「어느 쪽이 새 사람이냐」이기 때문이다.
 */
export function buildKeywordMap(
  bundle: StatsBundle | null,
  limit = 40
): StatsScatterGroup[] {
  const rows = overallRows(bundle, "query")
    .filter((row) => typeof row.position === "number" && typeof row.impressions === "number")
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, limit);

  if (rows.length === 0) return [];

  const groups: QueryGroup[] = ["generic", "brand"];
  return groups
    .map((group) => ({
      name: QUERY_GROUP_LABEL[group],
      color: QUERY_GROUP_COLOR[group],
      points: rows
        .filter((row) => groupOf(row.key ?? "") === group)
        .map((row) => ({
          x: row.position as number,
          y: row.impressions as number,
          z: row.clicks ?? 0
        }))
    }))
    .filter((entry) => entry.points.length > 0);
}

/* ─────────────────────── 6. 검색어 표 ─────────────────────── */

export type KeywordTag = { label: string; level: "high" | "mid" };

export type KeywordRow = {
  query: string;
  group: QueryGroup;
  groupLabel: string;
  impressions: string;
  clicks: string;
  ctr: string;
  position: string;
  tags: KeywordTag[];
};

/** 노출이 쌓였는데 안 눌리면 제목이 안 걸리는 것이다 */
function tagsFor(row: StatsPoint): KeywordTag[] {
  const tags: KeywordTag[] = [];
  const impressions = row.impressions ?? 0;
  const ctr = row.ctr;
  const position = row.position;

  if (impressions >= 50 && typeof ctr === "number" && ctr < 0.01) {
    tags.push({ label: "제목 손볼 것", level: "high" });
  }
  if (typeof position === "number" && position > 20) {
    tags.push({ label: "2쪽 밖", level: "mid" });
  }
  return tags;
}

export function buildKeywordTable(bundle: StatsBundle | null, limit = 20): KeywordRow[] {
  return overallRows(bundle, "query")
    .filter((row) => (row.key ?? "").trim() !== "")
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, limit)
    .map((row) => {
      const query = (row.key ?? "").trim();
      const group = groupOf(query);
      return {
        query,
        group,
        groupLabel: QUERY_GROUP_LABEL[group],
        impressions: intText(row.impressions) ?? "—",
        clicks: intText(row.clicks) ?? "—",
        ctr: pctText(row.ctr, 1) ?? "—",
        position: numText(row.position, 1) ?? "—",
        tags: tagsFor(row)
      };
    });
}

/* ─────────────────────── 7. 국문 · 영문 ─────────────────────── */

type LangId = "ko" | "en" | "file";

const LANG_LABEL: Record<LangId, string> = {
  ko: "국문",
  en: "영문",
  file: "문서"
};

const LANG_COLOR: Record<LangId, string> = {
  ko: STATS_COLORS[0],
  en: STATS_COLORS[2],
  file: STATS_MUTED
};

/**
 * 경로 앞에 /en 이 붙으면 영문이다.
 *
 * 다만 옛 사이트 노출의 절반 이상이 회사 소개 PDF 한 장이다. 파일은 경로에
 * /en 이 없어 그대로 두면 국문으로 잡혀 국문 노출이 부풀어 오른다. 언어를
 * 알 수 없는 문서는 따로 센다.
 */
function langOf(path: string): LangId {
  const clean = path.split("?")[0].split("#")[0];
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  if (last.includes(".")) return "file";
  return clean === "/en" || clean.startsWith("/en/") ? "en" : "ko";
}

export type LangSplit = {
  impressions: StatsSlice[];
  clicks: StatsSlice[];
};

export function buildLangSplit(bundle: StatsBundle | null): LangSplit {
  const rows = overallRows(bundle, "page");
  const acc: Record<LangId, { impressions: number; clicks: number }> = {
    ko: { impressions: 0, clicks: 0 },
    en: { impressions: 0, clicks: 0 },
    file: { impressions: 0, clicks: 0 }
  };

  for (const row of rows) {
    const id = langOf(row.key ?? "");
    if (typeof row.impressions === "number") acc[id].impressions += row.impressions;
    if (typeof row.clicks === "number") acc[id].clicks += row.clicks;
  }

  const slices = (field: "impressions" | "clicks"): StatsSlice[] =>
    (Object.keys(acc) as LangId[])
      .filter((id) => acc[id][field] > 0)
      .map((id) => ({ name: LANG_LABEL[id], value: acc[id][field], color: LANG_COLOR[id] }));

  return { impressions: slices("impressions"), clicks: slices("clicks") };
}

/* ─────────────────────── 8. 국가 · 기기 ─────────────────────── */

export function buildSearchCountry(bundle: StatsBundle | null, limit = 6): StatsRow[] {
  return ranked(sumByKey(overallRows(bundle, "country"), "impressions"))
    .slice(0, limit)
    .map((item) => ({ name: clip(item.name, 14), value: item.value }));
}

export function buildSearchDevice(bundle: StatsBundle | null): StatsSlice[] {
  return ranked(sumByKey(overallRows(bundle, "device"), "impressions")).map((item, index) => ({
    name: item.name,
    value: item.value,
    color: [STATS_COLORS[0], STATS_COLORS[2], STATS_TEXT][index] ?? STATS_MUTED
  }));
}
