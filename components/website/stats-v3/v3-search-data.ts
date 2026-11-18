/**
 * 검색 화면 v3 — 「회사 이름을 모르는 사람도 찾아오나요?」
 *
 * 회사 이름 · 일반 명사 나누기는 지금 검색 화면의 buildBrandSplit · isBrandQuery 를 그대로 쓴다.
 * 앞 기간이 옛 사이트면 증감을 비운다 — 요약 카드와 같은 기준.
 * 목표 키워드 표(3-8)와 검색어×들어온 페이지는 아직 모으지 않아 화면이 「준비 중」으로 둔다.
 */

import { pageTitleFromPath, type TitleMap } from "@/components/website/stats/content-data";
import { buildBrandSplit, isBrandQuery } from "@/components/website/stats/search-data";
import {
  makeCountDelta,
  pickRows,
  previousIsOldSite,
  type DeltaView
} from "@/components/website/stats/stats-data";
import {
  ga4,
  genericClicksOf,
  normalizePath,
  pathLang,
  prevDatesOf,
  prevGuard,
  prevReasonsOf,
  queryCoverage,
  queryDays,
  trimQueriesToCoverage,
  SEARCH_SOURCES,
  type DaySeries,
  type When
} from "@/components/website/stats-v3/v3-data";
import { normalizeKeyword } from "@/components/website/stats-v3/v3-keywords-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

const NONE: DeltaView = { delta: null, tone: "flat", previous: null };

/** 검색어별 그래프에서 「자료 없음」 대신 쓰는 까닭 */
const QUERY_NO_DATA = "검색어 자료 없음";

function gsc(bundle: StatsBundle | null, kind: string, when: When): StatsPoint[] {
  return pickRows(bundle, kind, SEARCH_SOURCES, when);
}

/* ─────────────────────── 회사 이름 · 일반 명사 ─────────────────────── */

export type SearchGroup = {
  clicks: string | null;
  impressions: string | null;
  /** 클릭 증감 */
  delta: DeltaView;
};

const unitOf = (delta: DeltaView, unit: string): DeltaView =>
  delta.previous == null ? delta : { ...delta, previous: `${delta.previous}${unit}` };

/** buildBrandSplit 의 노출 · 클릭 숫자. 검색어 행이 없으면 null */
export function searchGroups(bundle: StatsBundle | null): { brand: SearchGroup; generic: SearchGroup } | null {
  // 검색어 행이 들어온 날 수만큼만 두 기간을 잘라 같은 날 수끼리 견준다
  const split = buildBrandSplit(trimQueriesToCoverage(bundle));
  const impressions = split.counts.find((row) => row.label === "노출");
  const clicks = split.counts.find((row) => row.label === "클릭");
  if (!impressions || !clicks) return null;
  const oldSite = previousIsOldSite(bundle);
  const delta = (value: DeltaView) => (oldSite ? NONE : unitOf(value, "회"));
  return {
    brand: { clicks: clicks.brand, impressions: impressions.brand, delta: delta(clicks.brandDelta) },
    generic: { clicks: clicks.generic, impressions: impressions.generic, delta: delta(clicks.genericDelta) }
  };
}

/* ─────────────────────── 검색어 행이 들어온 날 (계산은 v3-data.ts) ─────────────────────── */

export { queryCoverage, queryDays, trimQueriesToCoverage, type QueryCoverage } from "@/components/website/stats-v3/v3-data";

/** 검색 숫자(회사 이름 · 일반 명사)를 센 날: 견준 날 수와 이번 기간 자료가 있는 날 수를 함께 */
export function searchRange(bundle: StatsBundle | null): {
  from: string;
  to: string;
  days: number;
  currentDays: number;
  prevFrom: string | null;
  prevTo: string | null;
} | null {
  const cover = queryCoverage(bundle);
  if (!cover) return null;
  return {
    from: cover.from,
    to: cover.to,
    days: cover.days,
    currentDays: cover.currentDays,
    prevFrom: cover.prevFrom,
    prevTo: cover.prevTo
  };
}

/* ─────────────────────── 일반 명사 검색 클릭 추이 ─────────────────────── */

/**
 * 날짜 칸은 구글 일별 행 날짜. 일반 명사 검색어 클릭을 날짜별로 더한다.
 * 검색어 행이 하나도 없는 날은 0 이 아니라 null(검색어 자료 없음). 앞 기간은 비교 날짜로 찾는다.
 */
export function genericClickSeries(bundle: StatsBundle | null): DaySeries {
  const sumBy = (rows: StatsPoint[]) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const query = row.key?.trim();
      if (!query || !row.date || isBrandQuery(query) || typeof row.clicks !== "number") continue;
      map.set(row.date, (map.get(row.date) ?? 0) + row.clicks);
    }
    return map;
  };
  const cur = sumBy(gsc(bundle, "query", "current"));
  const prev = sumBy(gsc(bundle, "query", "previous"));
  const curDays = queryDays(bundle, "current");
  const prevDays = prevGuard(bundle)(queryDays(bundle, "previous")) ?? new Set<string>();
  const dates = [...new Set(gsc(bundle, "daily", "current").map((row) => row.date).filter(Boolean))].sort();
  const prevDates = prevDatesOf(bundle, dates);
  return {
    dates,
    current: dates.map((date) => (curDays.has(date) ? (cur.get(date) ?? 0) : null)),
    previous: prevDates.map((date) => (date && prevDays.has(date) ? (prev.get(date) ?? 0) : null))
  };
}

/* ─────────────────────── 새로 잡힌 검색어 ─────────────────────── */

export type NewQuery = { query: string; impressions: number; clicks: number };

function sumQueries(rows: StatsPoint[]): Map<string, { impressions: number; clicks: number }> {
  const map = new Map<string, { impressions: number; clicks: number }>();
  for (const row of rows) {
    const query = row.key?.trim();
    if (!query) continue;
    const item = map.get(query) ?? { impressions: 0, clicks: 0 };
    if (typeof row.impressions === "number") item.impressions += row.impressions;
    if (typeof row.clicks === "number") item.clicks += row.clicks;
    map.set(query, item);
  }
  return map;
}

/**
 * B-3 ④ — 이번 기간 노출 1회 이상이고 앞 기간에 행이 없던 검색어. 회사 이름 검색은 뺀다(「목표 밖에서 발견한 말」).
 * 이번 기간 쪽은 두 기간 모두 검색어 자료가 있는 날 짝(queryCoverage)만 본다. 같은 자리 앞 기간 날 자료가 없는 날의 말은
 * 처음인지 가릴 수 없어서 넣지 않는다. 「앞 기간에 본 말」은 앞 기간 전체에서 찾는다(본 적 있는 말을 「새로」로 잘못 잡지 않게).
 * 견줄 짝이 하나도 없거나 앞 기간이 옛 사이트면 null: 화면은 「비교 불가」.
 */
export function newQueries(bundle: StatsBundle | null, limit = 3): NewQuery[] | null {
  if (previousIsOldSite(bundle)) return null;
  const cover = queryCoverage(bundle);
  if (!cover || cover.prevDates.length === 0) return null;
  const trimmed = trimQueriesToCoverage(bundle);
  const before = sumQueries(gsc(bundle, "query", "previous"));
  return [...sumQueries(gsc(trimmed, "query", "current")).entries()]
    .filter(([query, item]) => item.impressions >= 1 && !before.has(query) && !isBrandQuery(query))
    .map(([query, item]) => ({ query, ...item }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query))
    .slice(0, limit);
}

/* ─────────────────────── 검색으로 많이 들어온 콘텐츠 ─────────────────────── */

const SEARCH_CHANNEL = "Organic Search";

function searchLandings(bundle: StatsBundle | null, when: When): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of ga4(bundle, "landing_channel", when)) {
    if (row.key2?.trim() !== SEARCH_CHANNEL || typeof row.sessions !== "number") continue;
    const path = normalizePath(row.key);
    if (!path) continue;
    map.set(path, (map.get(path) ?? 0) + row.sessions);
  }
  return map;
}

export type SearchLandingRow = {
  path: string;
  title: string;
  lang: "ko" | "en";
  sessions: number;
  delta: DeltaView;
};

/** 검색(GA 채널 Organic Search)으로 들어온 방문이 많은 페이지 */
export function searchLandingTop(bundle: StatsBundle | null, titles: TitleMap, limit = 3): SearchLandingRow[] {
  const prevRows = prevGuard(bundle)(ga4(bundle, "landing_channel", "previous"));
  const previous = prevRows && prevRows.length > 0 ? searchLandings(bundle, "previous") : null;
  return [...searchLandings(bundle, "current").entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, sessions]) => {
      const before = previous ? (previous.get(path) ?? 0) : null;
      return {
        path,
        title: pageTitleFromPath(path, titles),
        lang: pathLang(path),
        sessions,
        delta: makeCountDelta(sessions, before, true, before == null ? null : `${before}회`)
      };
    });
}

/* ─────────────────────── 맨 위 답 문장 ─────────────────────── */

/** 「<em>일반 명사 검색으로 N회 클릭</em>되어, 회사 이름 밖에서도 찾아오고 있어요.」 */
export function searchAnswer(bundle: StatsBundle | null): { em: string; tail: string } | null {
  const generic = genericClicksOf(bundle, "current");
  if (generic == null) return null;
  if (generic > 0) {
    return {
      em: `일반 명사 검색으로 ${generic.toLocaleString("ko-KR")}회 클릭`,
      tail: "되어, 회사 이름 밖에서도 찾아오고 있어요."
    };
  }
  return { em: "일반 명사 검색 클릭은 아직 없어요.", tail: "" };
}

/* ─────────────────────── 날짜별 흐름 (검색) ─────────────────────── */

export type GscDays = {
  dates: string[];
  prevDates: (string | null)[];
  current: (number | null)[];
  previous: (number | null)[];
  /** 점마다 앞 기간 값이 빈 까닭(prevReasonsOf). 값이 있으면 null */
  prevReasons: (string | null)[];
};

/** 구글 일별 합계(클릭 · 노출) — 검색어를 숨긴 것까지 다 들어 있는 숫자. 앞 기간은 기간 길이만큼 앞 날짜 */
export function gscDaySeries(bundle: StatsBundle | null, field: "clicks" | "impressions"): GscDays {
  const byDay = (when: When) => {
    const map = new Map<string, number>();
    for (const row of gsc(bundle, "daily", when)) {
      const value = row[field];
      if (!row.date || typeof value !== "number") continue;
      map.set(row.date, (map.get(row.date) ?? 0) + value);
    }
    return map;
  };
  const cur = byDay("current");
  const prev = prevGuard(bundle)(byDay("previous"));
  const dates = [...cur.keys()].sort();
  const prevDates = prevDatesOf(bundle, dates);
  const previous = prevDates.map((date) => (prev && date ? (prev.get(date) ?? null) : null));
  return {
    dates,
    prevDates,
    current: dates.map((date) => cur.get(date) ?? null),
    previous,
    prevReasons: prevReasonsOf(bundle, prevDates, (i) => typeof previous[i] === "number")
  };
}

export type SplitDays = {
  dates: string[];
  /** 검색어 행이 없는 날은 null(0 이 아니라 자료 없음) */
  brand: (number | null)[];
  generic: (number | null)[];
  /** 구글이 검색어를 숨긴 몫 = 일별 합계 − 검색어별 합. 검색어 행이 없는 날은 null */
  hidden: (number | null)[];
  /** 일별 합계는 있는데 검색어 행이 아직 없는 날 */
  missing: string[];
  /** 같은 자리 앞 기간 날짜(gscDaySeries.prevDates) */
  prevDates: (string | null)[];
  /** 같은 자리 앞 기간 값: 마우스 상자용. 그 날 앞 기간 검색어 행이 없거나 앞 기간이 옛 사이트면 null */
  prevBrand: (number | null)[];
  prevGeneric: (number | null)[];
  prevHidden: (number | null)[];
  /** 점마다 앞 기간 값이 빈 까닭. 그 날 앞 기간 검색어 행이 없으면 「검색어 자료 없음」 */
  prevReasons: (string | null)[];
};

/** 검색어 행을 날짜별 회사 이름 · 일반 명사로 더한다 */
function splitByDate(rows: StatsPoint[], field: "clicks" | "impressions") {
  const brand = new Map<string, number>();
  const generic = new Map<string, number>();
  for (const row of rows) {
    const query = row.key?.trim();
    const value = row[field];
    if (!query || !row.date || typeof value !== "number") continue;
    const map = isBrandQuery(query) ? brand : generic;
    map.set(row.date, (map.get(row.date) ?? 0) + value);
  }
  return { brand, generic };
}

/**
 * 날짜별 회사 이름 · 일반 명사 · 숨긴 검색어 (클릭 또는 노출).
 * 검색어 행이 없는 날을 0 으로 두면 그날 합계 전부가 「숨긴 검색어」로 잡힌다. 그래서 그날은 셋 다 null.
 */
export function brandSplitDays(bundle: StatsBundle | null, field: "clicks" | "impressions"): SplitDays {
  const total = gscDaySeries(bundle, field);
  const covered = queryDays(bundle, "current");
  const { brand, generic } = splitByDate(gsc(bundle, "query", "current"), field);
  const on = <T>(date: string, value: T): T | null => (covered.has(date) ? value : null);
  // 앞 기간: 같은 자리 날에 앞 기간 검색어 행이 있을 때만 값. 옛 사이트면 모두 null
  const prevCovered = prevGuard(bundle)(queryDays(bundle, "previous")) ?? new Set<string>();
  const before = splitByDate(gsc(bundle, "query", "previous"), field);
  const prevOn = <T>(date: string | null, value: (day: string) => T): T | null =>
    date && prevCovered.has(date) ? value(date) : null;
  return {
    dates: total.dates,
    brand: total.dates.map((date) => on(date, brand.get(date) ?? 0)),
    generic: total.dates.map((date) => on(date, generic.get(date) ?? 0)),
    hidden: total.dates.map((date, i) =>
      on(date, Math.max(0, (total.current[i] ?? 0) - (brand.get(date) ?? 0) - (generic.get(date) ?? 0)))
    ),
    missing: total.dates.filter((date) => !covered.has(date)),
    prevDates: total.prevDates,
    prevBrand: total.prevDates.map((date) => prevOn(date, (day) => before.brand.get(day) ?? 0)),
    prevGeneric: total.prevDates.map((date) => prevOn(date, (day) => before.generic.get(day) ?? 0)),
    prevHidden: total.prevDates.map((date, i) => {
      const sum = total.previous[i];
      if (typeof sum !== "number") return null;
      return prevOn(date, (day) => Math.max(0, sum - (before.brand.get(day) ?? 0) - (before.generic.get(day) ?? 0)));
    }),
    prevReasons: prevReasonsOf(
      bundle,
      total.prevDates,
      (i) => {
        const date = total.prevDates[i];
        return date != null && prevCovered.has(date);
      },
      QUERY_NO_DATA
    )
  };
}

/** 이번 기간 구글 합계와 검색어별 합 — 「구글이 숨긴 검색어」 몫. 검색어 행이 있는 날만 더한다 */
export function hiddenQueryShare(bundle: StatsBundle | null): {
  impressions: number;
  clicks: number;
  listedImpressions: number;
  listedClicks: number;
  /** 검색어 행이 없어 뺀 날 */
  missing: string[];
} | null {
  const imp = brandSplitDays(bundle, "impressions");
  const clk = brandSplitDays(bundle, "clicks");
  if (imp.dates.length === 0 || imp.missing.length === imp.dates.length) return null;
  const add = (list: (number | null)[]) => list.reduce<number>((a, b) => a + (b ?? 0), 0);
  return {
    impressions: add(imp.brand) + add(imp.generic) + add(imp.hidden),
    clicks: add(clk.brand) + add(clk.generic) + add(clk.hidden),
    listedImpressions: add(imp.brand) + add(imp.generic),
    listedClicks: add(clk.brand) + add(clk.generic),
    missing: imp.missing
  };
}

/**
 * 목표 키워드 노출 날짜별 합: 검색어가 목표 키워드와 똑같은 행만(정규화 완전 일치). 검색어 행이 없는 날은 null.
 * previous 는 같은 자리 앞 기간 날(prevDates) 값. 그 날 앞 기간 검색어 행이 없거나 앞 기간이 옛 사이트면 null.
 */
export function targetKeywordDays(bundle: StatsBundle | null): {
  dates: string[];
  prevDates: (string | null)[];
  current: (number | null)[];
  previous: (number | null)[];
  prevReasons: (string | null)[];
  keywords: number;
} | null {
  const payload = bundle?.target_keywords?.target_keywords;
  if (!payload || payload.rows.length === 0) return null;
  const norms = new Set(payload.rows.map((row) => normalizeKeyword(row.keyword)));
  const { dates, prevDates } = gscDaySeries(bundle, "impressions");
  const sumOf = (when: When) => {
    const map = new Map<string, number>();
    for (const row of gsc(bundle, "query", when)) {
      if (!row.date || !row.key || !norms.has(normalizeKeyword(row.key))) continue;
      map.set(row.date, (map.get(row.date) ?? 0) + (row.impressions ?? 0));
    }
    return map;
  };
  const covered = queryDays(bundle, "current");
  const prevCovered = prevGuard(bundle)(queryDays(bundle, "previous")) ?? new Set<string>();
  const map = sumOf("current");
  const before = sumOf("previous");
  return {
    dates,
    prevDates,
    current: dates.map((date) => (covered.has(date) ? (map.get(date) ?? 0) : null)),
    previous: prevDates.map((date) => (date && prevCovered.has(date) ? (before.get(date) ?? 0) : null)),
    prevReasons: prevReasonsOf(
      bundle,
      prevDates,
      (i) => {
        const date = prevDates[i];
        return date != null && prevCovered.has(date);
      },
      QUERY_NO_DATA
    ),
    keywords: payload.rows.length
  };
}
