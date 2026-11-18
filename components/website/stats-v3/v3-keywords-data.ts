/**
 * 검색 화면 「목표 키워드」 표 (3-8) — 목업 #view-search 의 열 그대로.
 *
 * 순위·노출·클릭은 홈페이지가 계산한 target_keywords 를 쓴다(검색어를 정규화해 「같은」 것만 셈).
 * 추이는 query 행, 들어온 페이지는 query_page 행(검색어 × 페이지)에서 같은 정규화로 찾는다.
 * 정규화 규칙은 홈페이지 lib/stats/target-keywords-core.ts normalizeKeyword 와 같다.
 */

import { pageTitleFromPath, type TitleMap } from "@/components/website/stats/content-data";
import { makeCountDelta, pickRows, previousIsOldSite, type DeltaView } from "@/components/website/stats/stats-data";
import {
  normalizePath,
  prevDateOf,
  queryCoverage,
  SEARCH_SOURCES,
  trimQueriesToCoverage,
  type When
} from "@/components/website/stats-v3/v3-data";
import type { StatsBundle, StatsPoint, TargetKeywordsPayload } from "@/lib/website/stats";

/** 비교용: NFKC · 소문자 · 공백·문장부호·기호 뺌 (홈페이지와 같은 규칙) */
export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export type KeywordChange =
  | { type: "delta"; delta: DeltaView }
  | { type: "new" }
  | { type: "none" }
  /** 두 기간 모두 검색어 자료가 있는 날 짝이 없다. 화면은 「—」 */
  | { type: "nopair" };

export type TargetKeywordView = {
  id: number;
  keyword: string;
  lang: "ko" | "en";
  impressions: number;
  clicks: number;
  /** 「18.4」 · 노출이 없으면 null */
  position: string | null;
  change: KeywordChange;
  /** 이 검색어로 가장 많이 들어온 페이지 제목. 검색어×페이지 자료가 없으면 null */
  landing: string | null;
  /** 날짜별 노출 — 이번 기간 / 앞 기간 같은 순번 */
  trend: { current: number[]; previous: (number | null)[] };
};

export type TargetKeywordsView = {
  /** 응답에 target_keywords 가 없으면(옛 홈페이지) null */
  payload: TargetKeywordsPayload | null;
  rows: TargetKeywordView[];
  /** query_page 행이 하나라도 있나 — 없으면 「들어온 페이지」 열에 「준비 중」 */
  hasLanding: boolean;
  /** 증감에 실제로 견준 날 수(두 기간 모두 검색어 자료가 있는 날 짝 수). 0 일 수 있다. 옛 사이트면 null */
  comparedDays: number | null;
  /** 표 위 작은 글: 증감을 몇 날끼리 견줬는지. 앞 기간이 옛 사이트면 null(칸마다 「비교 불가」) */
  compareNote: string | null;
};

function gscRows(bundle: StatsBundle | null, kind: string, when: When): StatsPoint[] {
  return pickRows(bundle, kind, SEARCH_SOURCES, when);
}

function dailyImpressions(rows: StatsPoint[], norm: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.date || !row.key || normalizeKeyword(row.key) !== norm) continue;
    map.set(row.date, (map.get(row.date) ?? 0) + (row.impressions ?? 0));
  }
  return map;
}

function topLanding(rows: StatsPoint[], norm: string): string | null {
  const byPath = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    if (!row.key || normalizeKeyword(row.key) !== norm) continue;
    // 쿼리 문자열 · 끝 / 가 다른 같은 페이지는 한 경로로 합친다
    const path = normalizePath(row.key2);
    if (!path) continue;
    const prev = byPath.get(path) ?? { clicks: 0, impressions: 0 };
    prev.clicks += row.clicks ?? 0;
    prev.impressions += row.impressions ?? 0;
    byPath.set(path, prev);
  }
  let best: string | null = null;
  let bestScore: [number, number] = [-1, -1];
  for (const [path, value] of byPath) {
    if (
      value.clicks > bestScore[0] ||
      (value.clicks === bestScore[0] && value.impressions > bestScore[1])
    ) {
      best = path;
      bestScore = [value.clicks, value.impressions];
    }
  }
  return best;
}

function datesOf(rows: StatsPoint[]): string[] {
  return [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
}

export function targetKeywordsView(bundle: StatsBundle | null, titles: TitleMap): TargetKeywordsView {
  const payload = bundle?.target_keywords?.target_keywords ?? null;
  if (!payload) return { payload: null, rows: [], hasLanding: false, comparedDays: null, compareNote: null };

  const oldSite = previousIsOldSite(bundle);
  const queryCur = gscRows(bundle, "query", "current");
  // 앞 기간이 옛 사이트면 증감처럼 추이의 점선도 그리지 않는다
  const queryPrev = oldSite ? [] : gscRows(bundle, "query", "previous");
  const pageCur = gscRows(bundle, "query_page", "current");
  const curDates = datesOf(queryCur);
  const prevDates = new Set(datesOf(queryPrev));
  const prevDate = prevDateOf(bundle);
  // 증감은 두 기간 모두 검색어 자료가 있는 날 짝만 더해 견준다(검색 화면 위 숫자와 같은 규칙)
  const cover = oldSite ? null : queryCoverage(bundle);
  // 실제 짝 수는 견줄 수 있는지와 따로 센다. 짝이 없으면 queryCoverage 의 days 는 이번 기간 날 수라서 쓰면 안 된다
  const pairCount = cover ? cover.prevDates.length : 0;
  const paired = pairCount > 0 ? trimQueriesToCoverage(bundle) : null;
  const pairedCur = paired ? gscRows(paired, "query", "current") : [];
  const pairedPrev = paired ? gscRows(paired, "query", "previous") : [];
  const sumOf = (rows: StatsPoint[], norm: string) => {
    let total = 0;
    for (const value of dailyImpressions(rows, norm).values()) total += value;
    return total;
  };

  const rows = payload.rows.map((row): TargetKeywordView => {
    const norm = normalizeKeyword(row.keyword);
    const cur = dailyImpressions(queryCur, norm);
    const prev = dailyImpressions(queryPrev, norm);
    let change: KeywordChange;
    if (oldSite) change = { type: "none" };
    else if (!paired) change = { type: "nopair" };
    else {
      const now = sumOf(pairedCur, norm);
      const before = sumOf(pairedPrev, norm);
      if (row.newly_seen && before === 0 && now > 0) change = { type: "new" };
      else if (now === 0 && before === 0) change = { type: "none" };
      else
        change = {
          type: "delta",
          delta: makeCountDelta(now, before, true, `${before.toLocaleString("ko-KR")}회`)
        };
    }
    const landingPath = topLanding(pageCur, norm);
    return {
      id: row.id,
      keyword: row.keyword,
      lang: row.lang,
      impressions: row.current.impressions,
      clicks: row.current.clicks,
      position: row.current.position == null ? null : row.current.position.toFixed(1),
      change,
      landing: landingPath ? pageTitleFromPath(landingPath, titles) : null,
      trend: {
        current: curDates.map((date) => cur.get(date) ?? 0),
        // 순번이 아니라 비교 날짜로 찾는다. 그 날 검색어 행이 없으면 null(점선이 끊긴다)
        previous: curDates.map((date) => {
          const before = prevDate(date);
          return before && prevDates.has(before) ? (prev.get(before) ?? 0) : null;
        })
      }
    };
  });

  // 옛 사이트가 아니면 0일이어도 보인다(0이면 칸마다 「—」)
  const comparedDays = oldSite ? null : pairCount;
  return {
    payload,
    rows,
    hasLanding: pageCur.length > 0,
    comparedDays,
    compareNote: oldSite
      ? null
      : comparedDays && comparedDays > 0
        ? `앞 기간보다는 두 기간 모두 검색어 자료가 있는 ${comparedDays}일끼리 견줌`
        : "두 기간 모두 검색어 자료가 있는 날이 0일이라 앞 기간보다는 「—」"
  };
}
