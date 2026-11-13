/**
 * 검색 화면이 쓰는 값 만들기.
 *
 * apollonworks.com 하나의 데이터다. 「새 사이트」와 「옛 사이트」로 나누지
 * 않는다. 같은 도메인이고 어느 시점에 내용이 바뀌었을 뿐이다. 그 시점은
 * 그래프의 세로선 하나로 알린다.
 *
 * ── 두 갈래로 들어온다
 *   current·previous  날짜가 있는 행. daily 뿐 아니라 query·page·country·device
 *                     도 홈페이지가 date 차원으로 걷으면 여기로 온다.
 *   overall           date 가 NULL 인 합계 행(옛 CSV). 기간으로 자를 수 없다.
 *                     화면은 이 행으로 빈 기간을 채우지 않는다.
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
  type DeltaTone,
  type DeltaView
} from "@/components/website/stats/stats-data";
import { countryLabel, deviceLabel } from "@/components/website/stats/stats-labels";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

/** 검색 화면이 쓰는 kind. 한 번에 받아 온다 */
export const SEARCH_KINDS = ["daily", "query", "country", "device", "page"];

/**
 * 검색 값은 출처가 gsc 또는 gsc_http 다. 합친 뒤에는 같은 사이트의 앞뒤 기간이다.
 * 하나만 고르면 1년을 골라도 뒤쪽만 나온다.
 */
const SEARCH_SOURCES = ["gsc", "gsc_http"] as const;

/** 고른 기간 안의 일별 검색 성과 */
export function searchDaily(bundle: StatsBundle | null): StatsPoint[] {
  return pickRows(bundle, "daily", SEARCH_SOURCES, "current");
}

/**
 * 검색어·페이지·국가·기기 행.
 * 고른 기간의 날짜 행만 key 로 합친다. 없으면 빈 배열이다.
 */
function dimRows(
  bundle: StatsBundle | null,
  kind: string,
  when: "current" | "previous" = "current"
): { rows: StatsPoint[]; scoped: boolean } {
  const dated = pickRows(bundle, kind, SEARCH_SOURCES, when);
  if (dated.length === 0) return { rows: [], scoped: false };
  return { rows: aggregateByKey(dated), scoped: true };
}

/** 같은 key 의 날짜 행을 노출·클릭 합, 순위는 노출 무게 평균으로 묶는다 */
function aggregateByKey(rows: StatsPoint[]): StatsPoint[] {
  const map = new Map<string, StatsPoint>();
  for (const row of rows) {
    const key = row.key ?? "";
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...row,
        date: "",
        impressions: typeof row.impressions === "number" ? row.impressions : null,
        clicks: typeof row.clicks === "number" ? row.clicks : null,
        position: typeof row.position === "number" ? row.position : null,
        ctr: null
      });
      continue;
    }
    const impA = typeof prev.impressions === "number" ? prev.impressions : 0;
    const impB = typeof row.impressions === "number" ? row.impressions : 0;
    const clickA = typeof prev.clicks === "number" ? prev.clicks : 0;
    const clickB = typeof row.clicks === "number" ? row.clicks : 0;
    const posA = typeof prev.position === "number" ? prev.position : null;
    const posB = typeof row.position === "number" ? row.position : null;
    let position: number | null = null;
    if (posA != null && posB != null && impA + impB > 0) {
      position = (posA * impA + posB * impB) / (impA + impB);
    } else if (posA != null) position = posA;
    else if (posB != null) position = posB;
    map.set(key, {
      ...prev,
      impressions: impA + impB,
      clicks: clickA + clickB,
      position
    });
  }
  return [...map.values()].map((row) => {
    const impressions = row.impressions;
    const clicks = row.clicks;
    const ctr =
      typeof impressions === "number" &&
      impressions > 0 &&
      typeof clicks === "number"
        ? clicks / impressions
        : null;
    return { ...row, ctr };
  });
}

/** 표·스탬프용 기간. 날짜 행이 있을 때만 고른 기간을 돌려준다 */
export function searchOverallPeriod(
  bundle: StatsBundle | null,
  kind = "query"
): { from: string; to: string } | null {
  const dated = pickRows(bundle, kind, SEARCH_SOURCES, "current");
  if (dated.length === 0) return null;
  const result = bundle?.[kind];
  if (result?.from && result?.to) return { from: result.from, to: result.to };
  return null;
}

/** 날짜 행으로 그렸으면 true — 각주 문구를 나눌 때 쓴다 */
export function searchDimScoped(bundle: StatsBundle | null, kind = "query"): boolean {
  return pickRows(bundle, kind, SEARCH_SOURCES, "current").length > 0;
}

/* ─────────────────────── 1. 전체 KPI ─────────────────────── */

export type SearchKpi = {
  id: string;
  label: string;
  value: string;
  sub: string;
  delta: string | null;
  tone: DeltaTone;
  previous: string | null;
};

function ctrOf(rows: StatsPoint[]): number | null {
  const clicks = sumField(rows, "clicks");
  const impressions = sumField(rows, "impressions");
  if (clicks == null || impressions == null || impressions === 0) return null;
  return clicks / impressions;
}

/** 노출·클릭·클릭률·평균 순위. 고른 기간과 그 앞 기간을 견준다 */
export function buildSearchKpis(bundle: StatsBundle | null): SearchKpi[] {
  const cur = searchDaily(bundle);
  const prev = pickRows(bundle, "daily", SEARCH_SOURCES, "previous");

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
      ...makeDelta(curImp, prevImp, "ratio", true, intText(prevImp))
    },
    {
      id: "clicks",
      label: "클릭",
      value: intText(curClick) ?? "—",
      sub: "그중 눌린 횟수",
      ...makeDelta(curClick, prevClick, "ratio", true, intText(prevClick))
    },
    {
      id: "ctr",
      label: "클릭률",
      value: pctText(curCtr, 1) ?? "—",
      sub: "보통 2~5%",
      ...makeDelta(curCtr, prevCtr, "point", true, pctText(prevCtr, 1))
    },
    {
      id: "position",
      label: "평균 순위",
      value: numText(curPos, 1) ?? "—",
      sub: "1쪽은 10위까지",
      // 순위는 작을수록 좋다. 내려가면 파란색이 되어야 한다
      ...makeDelta(curPos, prevPos, "abs", false, numText(prevPos, 1))
    }
  ];
}

/* ─────────────────────── 2. 노출과 클릭 추이 ─────────────────────── */

/**
 * 막대는 노출, 선은 클릭. 두 값의 크기가 스무 배쯤 차이 나 축을 나눈다.
 * prev* 는 앞 기간의 같은 순번 날짜 값이다. 요약 방문 추이와 같은 맞춤이다.
 */
export function buildSearchTrend(bundle: StatsBundle | null): StatsRow[] {
  const previous = [...pickRows(bundle, "daily", SEARCH_SOURCES, "previous")].sort(byDate);
  return [...searchDaily(bundle)].sort(byDate).map((row, index) => ({
    date: shortDate(row.date),
    impressions: row.impressions,
    clicks: row.clicks,
    prevImpressions: previous[index]?.impressions ?? null,
    prevClicks: previous[index]?.clicks ?? null
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
  const rows = dimRows(bundle, "query").rows.filter(
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
  counts: {
    label: string;
    brand: string;
    generic: string;
    brandDelta: DeltaView;
    genericDelta: DeltaView;
  }[];
};

type GroupSums = {
  impressions: Record<QueryGroup, number>;
  clicks: Record<QueryGroup, number>;
};

function sumByGroup(rows: StatsPoint[]): GroupSums {
  const acc: GroupSums = {
    impressions: { brand: 0, generic: 0 },
    clicks: { brand: 0, generic: 0 }
  };
  for (const row of rows) {
    const group = groupOf(row.key ?? "");
    if (typeof row.impressions === "number") acc.impressions[group] += row.impressions;
    if (typeof row.clicks === "number") acc.clicks[group] += row.clicks;
  }
  return acc;
}

/** 앞 기간 검색어 행이 하나도 없으면 null — 0 과 견주지 않고 비교 불가로 둔다 */
function countDelta(current: number, previous: number | null): DeltaView {
  return makeDelta(current, previous, "ratio", true, intText(previous));
}

/**
 * 검색어에는 날짜가 없다. 목업처럼 달별로 쌓을 수 없어 합계를 비율로 보인다.
 * 「일반이 늘어야 한다」는 흐름은 날짜 있는 검색어가 쌓여야 보인다.
 */
export function buildBrandSplit(bundle: StatsBundle | null): BrandSplit {
  const rows = dimRows(bundle, "query").rows;
  if (rows.length === 0) return { rows: [], counts: [] };

  const acc = sumByGroup(rows);
  const previousRows = dimRows(bundle, "query", "previous").rows;
  const before = previousRows.length > 0 ? sumByGroup(previousRows) : null;

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
        generic: intText(acc.impressions.generic) ?? "—",
        brandDelta: countDelta(acc.impressions.brand, before?.impressions.brand ?? null),
        genericDelta: countDelta(acc.impressions.generic, before?.impressions.generic ?? null)
      },
      {
        label: "클릭",
        brand: intText(acc.clicks.brand) ?? "—",
        generic: intText(acc.clicks.generic) ?? "—",
        brandDelta: countDelta(acc.clicks.brand, before?.clicks.brand ?? null),
        genericDelta: countDelta(acc.clicks.generic, before?.clicks.generic ?? null)
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
  const rows = dimRows(bundle, "query")
    .rows.filter(
      (row) => typeof row.position === "number" && typeof row.impressions === "number"
    )
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
  delta: {
    impressions: DeltaView;
    clicks: DeltaView;
    ctr: DeltaView;
    position: DeltaView;
  };
  tags: KeywordTag[];
};

const NO_DELTA: DeltaView = { delta: null, tone: "flat", previous: null };

/**
 * 앞 기간 같은 검색어와 견준다. 앞 기간에 없던 검색어는 노출·클릭 0 과 견주고,
 * 클릭률·순위는 견줄 값이 없어 비교 불가다. 앞 기간 행이 아예 없으면 모두 비교 불가.
 */
function keywordDelta(row: StatsPoint, previous: Map<string, StatsPoint> | null): KeywordRow["delta"] {
  if (previous === null) {
    return { impressions: NO_DELTA, clicks: NO_DELTA, ctr: NO_DELTA, position: NO_DELTA };
  }
  const before = previous.get((row.key ?? "").trim());
  const impressions = before ? before.impressions : 0;
  const clicks = before ? before.clicks : 0;
  const ctr = before ? before.ctr : null;
  const position = before ? before.position : null;
  return {
    impressions: makeDelta(row.impressions, impressions, "ratio", true, intText(impressions)),
    clicks: makeDelta(row.clicks, clicks, "ratio", true, intText(clicks)),
    ctr: makeDelta(row.ctr, ctr, "point", true, pctText(ctr, 1)),
    position: makeDelta(row.position, position, "abs", false, numText(position, 1))
  };
}

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

/**
 * 카드의 일별 노출·클릭 합에서 검색어 전체 합을 뺀 것.
 * 구글이 검색어를 공개하지 않은 분량이다. 표에 보이는 20개가 아니다.
 * 둘 다 0 이하면 null.
 */
export function unpublishedQueryGap(
  bundle: StatsBundle | null
): { impressions: number; clicks: number } | null {
  const daily = searchDaily(bundle);
  const cardImp = sumField(daily, "impressions");
  const cardClicks = sumField(daily, "clicks");
  if (cardImp == null && cardClicks == null) return null;

  let queryImp = 0;
  let queryClicks = 0;
  for (const row of dimRows(bundle, "query").rows) {
    if (typeof row.impressions === "number") queryImp += row.impressions;
    if (typeof row.clicks === "number") queryClicks += row.clicks;
  }

  const impressions = Math.max(0, Math.round((cardImp ?? 0) - queryImp));
  const clicks = Math.max(0, Math.round((cardClicks ?? 0) - queryClicks));
  if (impressions <= 0 && clicks <= 0) return null;
  return { impressions, clicks };
}

export function buildKeywordTable(bundle: StatsBundle | null, limit = 20): KeywordRow[] {
  const previousRows = dimRows(bundle, "query", "previous").rows;
  const previous =
    previousRows.length > 0
      ? new Map(previousRows.map((row) => [(row.key ?? "").trim(), row]))
      : null;

  return dimRows(bundle, "query")
    .rows.filter((row) => (row.key ?? "").trim() !== "")
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
        delta: keywordDelta(row, previous),
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
 * 다만 노출의 절반 이상이 회사 소개 PDF 한 장이다. 파일은 경로에 /en 이 없어
 * 그대로 두면 국문으로 잡혀 국문 노출이 부풀어 오른다. 언어를 알 수 없는
 * 문서는 따로 센다.
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
  const rows = dimRows(bundle, "page").rows;
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
  return ranked(sumByKey(dimRows(bundle, "country").rows, "impressions"))
    .slice(0, limit)
    .map((item) => ({ name: clip(countryLabel(item.name), 14), value: item.value }));
}

export function buildSearchDevice(bundle: StatsBundle | null): StatsSlice[] {
  return ranked(sumByKey(dimRows(bundle, "device").rows, "impressions")).map((item, index) => ({
    name: deviceLabel(item.name),
    value: item.value,
    color: [STATS_COLORS[0], STATS_COLORS[2], STATS_TEXT][index] ?? STATS_MUTED
  }));
}
