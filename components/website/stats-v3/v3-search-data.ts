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
  readActualRange,
  readGscLastDate,
  type DeltaView
} from "@/components/website/stats/stats-data";
import {
  ga4,
  genericClicksOf,
  normalizePath,
  pathLang,
  prevDatesOf,
  prevGuard,
  SEARCH_SOURCES,
  type DaySeries,
  type When
} from "@/components/website/stats-v3/v3-data";
import { normalizeKeyword } from "@/components/website/stats-v3/v3-keywords-data";
import { addIsoDays, inclusiveDays } from "@/components/website/stats-v3/v3-period";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

const NONE: DeltaView = { delta: null, tone: "flat", previous: null };

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
  // 구글 자료가 늦게 들어온 날 수만큼 앞 기간도 잘라 같은 날 수끼리 견준다
  const split = buildBrandSplit(trimPreviousToGsc(bundle));
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

/** 검색 숫자가 들어온 기간 — 끝은 구글 자료 마지막 날까지 */
export function searchRange(bundle: StatsBundle | null): {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
} | null {
  const range = readActualRange(bundle);
  if (!range) return null;
  const last = readGscLastDate(bundle);
  const to = last && last < range.actualTo ? last : range.actualTo;
  if (to < range.actualFrom) return null;
  return { from: range.actualFrom, to, prevFrom: range.prevFrom, prevTo: range.prevTo };
}

/* ─────────────────────── 일반 명사 검색 클릭 추이 ─────────────────────── */

/** 날짜 칸은 구글 일별 행 날짜. 일반 명사 검색어 클릭을 날짜별로 더하고, 없는 날은 0 */
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
  const days = (when: When) => [...new Set(gsc(bundle, "daily", when).map((row) => row.date).filter(Boolean))].sort();
  const cur = sumBy(gsc(bundle, "query", "current"));
  const prev = sumBy(gsc(bundle, "query", "previous"));
  const dates = days("current");
  const prevDates = prevGuard(bundle)(days("previous")) ?? [];
  return {
    dates,
    current: dates.map((date) => cur.get(date) ?? 0),
    previous: dates.map((_, index) => (prevDates[index] ? (prev.get(prevDates[index]) ?? 0) : null))
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
 * 앞 기간 검색어 행이 하나도 없거나 앞 기간이 옛 사이트면 null — 화면은 「비교 불가」.
 */
export function newQueries(bundle: StatsBundle | null, limit = 3): NewQuery[] | null {
  const previousRows = gsc(bundle, "query", "previous");
  if (previousRows.length === 0 || previousIsOldSite(bundle)) return null;
  const before = sumQueries(previousRows);
  return [...sumQueries(gsc(bundle, "query", "current")).entries()]
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

/**
 * 구글 자료는 2~3일 늦게 들어온다. 이번 기간이 구글 마지막 날에서 끊기면,
 * 앞 기간도 같은 날 수까지만 남겨야 공정하게 견줄 수 있다(구글 행만 자른다).
 */
export function trimPreviousToGsc(bundle: StatsBundle | null): StatsBundle | null {
  if (!bundle) return bundle;
  const range = readActualRange(bundle);
  const last = readGscLastDate(bundle);
  if (!range || !last || last >= range.actualTo || last < range.actualFrom) return bundle;
  const cutoff = addIsoDays(range.prevFrom, inclusiveDays(range.actualFrom, last) - 1);
  const isGsc = (row: StatsPoint) => (SEARCH_SOURCES as readonly string[]).includes(row.source);
  const out: StatsBundle = {};
  for (const [kind, result] of Object.entries(bundle)) {
    out[kind] = result
      ? { ...result, previous: result.previous.filter((row) => !isGsc(row) || !row.date || row.date <= cutoff) }
      : result;
  }
  return out;
}

export type GscDays = {
  dates: string[];
  prevDates: (string | null)[];
  current: (number | null)[];
  previous: (number | null)[];
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
  return {
    dates,
    prevDates,
    current: dates.map((date) => cur.get(date) ?? null),
    previous: prevDates.map((date) => (prev && date ? (prev.get(date) ?? null) : null))
  };
}

export type SplitDays = {
  dates: string[];
  brand: number[];
  generic: number[];
  /** 구글이 검색어를 숨긴 몫 = 일별 합계 − 검색어별 합 */
  hidden: number[];
};

/** 날짜별 회사 이름 · 일반 명사 · 숨긴 검색어 (클릭 또는 노출) */
export function brandSplitDays(bundle: StatsBundle | null, field: "clicks" | "impressions"): SplitDays {
  const total = gscDaySeries(bundle, field);
  const brand = new Map<string, number>();
  const generic = new Map<string, number>();
  for (const row of gsc(bundle, "query", "current")) {
    const query = row.key?.trim();
    const value = row[field];
    if (!query || !row.date || typeof value !== "number") continue;
    const map = isBrandQuery(query) ? brand : generic;
    map.set(row.date, (map.get(row.date) ?? 0) + value);
  }
  return {
    dates: total.dates,
    brand: total.dates.map((date) => brand.get(date) ?? 0),
    generic: total.dates.map((date) => generic.get(date) ?? 0),
    hidden: total.dates.map((date, i) =>
      Math.max(0, (total.current[i] ?? 0) - (brand.get(date) ?? 0) - (generic.get(date) ?? 0))
    )
  };
}

/** 이번 기간 구글 합계와 검색어별 합 — 「구글이 숨긴 검색어」 몫 */
export function hiddenQueryShare(bundle: StatsBundle | null): {
  impressions: number;
  clicks: number;
  listedImpressions: number;
  listedClicks: number;
} | null {
  const imp = brandSplitDays(bundle, "impressions");
  const clk = brandSplitDays(bundle, "clicks");
  if (imp.dates.length === 0) return null;
  const add = (list: number[]) => list.reduce((a, b) => a + b, 0);
  return {
    impressions: add(imp.brand) + add(imp.generic) + add(imp.hidden),
    clicks: add(clk.brand) + add(clk.generic) + add(clk.hidden),
    listedImpressions: add(imp.brand) + add(imp.generic),
    listedClicks: add(clk.brand) + add(clk.generic)
  };
}

/** 목표 키워드 노출 날짜별 합 — 검색어가 목표 키워드와 똑같은 행만(정규화 완전 일치) */
export function targetKeywordDays(
  bundle: StatsBundle | null
): { dates: string[]; current: number[]; keywords: number } | null {
  const payload = bundle?.target_keywords?.target_keywords;
  if (!payload || payload.rows.length === 0) return null;
  const norms = new Set(payload.rows.map((row) => normalizeKeyword(row.keyword)));
  const dates = gscDaySeries(bundle, "impressions").dates;
  const map = new Map<string, number>();
  for (const row of gsc(bundle, "query", "current")) {
    if (!row.date || !row.key || !norms.has(normalizeKeyword(row.key))) continue;
    map.set(row.date, (map.get(row.date) ?? 0) + (row.impressions ?? 0));
  }
  return { dates, current: dates.map((date) => map.get(date) ?? 0), keywords: payload.rows.length };
}
