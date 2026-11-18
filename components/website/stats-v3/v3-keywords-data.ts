/**
 * 검색 화면 「목표 키워드」 표 (3-8) — 목업 #view-search 의 열 그대로.
 *
 * 순위·노출·클릭은 홈페이지가 계산한 target_keywords 를 쓴다(검색어를 정규화해 「같은」 것만 셈).
 * 추이는 query 행, 들어온 페이지는 query_page 행(검색어 × 페이지)에서 같은 정규화로 찾는다.
 * 정규화 규칙은 홈페이지 lib/stats/target-keywords-core.ts normalizeKeyword 와 같다.
 */

import { pageTitleFromPath, type TitleMap } from "@/components/website/stats/content-data";
import { makeCountDelta, pickRows, previousIsOldSite, type DeltaView } from "@/components/website/stats/stats-data";
import { SEARCH_SOURCES, type When } from "@/components/website/stats-v3/v3-data";
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
  | { type: "none" };

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
  trend: { current: number[]; previous: number[] };
};

export type TargetKeywordsView = {
  /** 응답에 target_keywords 가 없으면(옛 홈페이지) null */
  payload: TargetKeywordsPayload | null;
  rows: TargetKeywordView[];
  /** query_page 행이 하나라도 있나 — 없으면 「들어온 페이지」 열에 「준비 중」 */
  hasLanding: boolean;
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
    if (!row.key || !row.key2 || normalizeKeyword(row.key) !== norm) continue;
    const prev = byPath.get(row.key2) ?? { clicks: 0, impressions: 0 };
    prev.clicks += row.clicks ?? 0;
    prev.impressions += row.impressions ?? 0;
    byPath.set(row.key2, prev);
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
  if (!payload) return { payload: null, rows: [], hasLanding: false };

  const oldSite = previousIsOldSite(bundle);
  const queryCur = gscRows(bundle, "query", "current");
  const queryPrev = gscRows(bundle, "query", "previous");
  const pageCur = gscRows(bundle, "query_page", "current");
  const curDates = datesOf(queryCur);
  const prevDates = datesOf(queryPrev);

  const rows = payload.rows.map((row): TargetKeywordView => {
    const norm = normalizeKeyword(row.keyword);
    const cur = dailyImpressions(queryCur, norm);
    const prev = dailyImpressions(queryPrev, norm);
    let change: KeywordChange;
    if (oldSite) change = { type: "none" };
    else if (row.newly_seen) change = { type: "new" };
    else if (row.current.impressions === 0 && row.previous.impressions === 0) change = { type: "none" };
    else
      change = {
        type: "delta",
        delta: makeCountDelta(
          row.current.impressions,
          row.previous.impressions,
          true,
          `${row.previous.impressions.toLocaleString("ko-KR")}회`
        )
      };
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
        previous: prevDates.map((date) => prev.get(date) ?? 0)
      }
    };
  });

  return { payload, rows, hasLanding: pageCur.length > 0 };
}
