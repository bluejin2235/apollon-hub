/**
 * 요약 화면 데이터 — website_stats 행을 화면 모델로 옮긴다.
 *
 * 규칙 하나: 값이 없으면 null·빈 배열로 둔다. 0 으로 바꾸지 않는다.
 * null 을 0 으로 바꾸면 진짜 0 인지 아직 안 걷힌 것인지 구분할 수 없다.
 *
 * 홈페이지 API 는 고른 기간이 오픈일에 걸치면 시작을 오픈일로 당긴다.
 * 그래서 current 는 새 사이트 값이고, previous 는 옛 사이트일 수 있다.
 */

import { type StatsRow } from "@/components/website/stats/stats-chart";
import { isBrandQuery } from "@/components/website/stats/search-data";
import {
  byDate,
  intText,
  makeDelta,
  pctText,
  pickRows,
  ranked,
  readActualRange,
  readLaunchDate,
  shortDate,
  SITE_LAUNCH_DATE,
  sumByKey,
  sumField,
  weightedField,
  type DeltaTone
} from "@/components/website/stats/stats-data";
import { withUnit, type SummaryCardId } from "@/components/website/stats/stats-labels";
import type { PeriodUsersCompare, StatsBundle, StatsPoint } from "@/lib/website/stats";

/** 요약 화면이 쓰는 kind 전부. 한 번에 받아 온다 */
export const SUMMARY_KINDS = ["daily", "channel", "page", "query", "landing_channel"];

const SEARCH_SOURCES = ["gsc", "gsc_http"] as const;

/** GA4 기본 채널 그룹에서 검색엔진으로 온 방문 */
const SEARCH_CHANNEL = "Organic Search";

type Rows = StatsPoint[];
type When = "current" | "previous";

function ga4(bundle: StatsBundle | null, kind: string, when: When): Rows {
  return pickRows(bundle, kind, "ga4", when);
}

const total = sumField;
const weighted = weightedField;

/** period_users.current 가 숫자일 때만 기간 전체 방문자로 본다 */
function readPeriodUsers(bundle: StatsBundle | null): PeriodUsersCompare | null {
  if (!bundle) return null;
  for (const result of Object.values(bundle)) {
    const value = result?.period_users;
    if (!value || typeof value !== "object") continue;
    if (typeof value.current === "number") return value;
  }
  return null;
}

/* ─────────────────────── 카드 셋 ─────────────────────── */

/** 방문자 — 기간 전체를 한 번 센 값. 없으면 날짜별 합으로 대신한다 */
function visitsOf(bundle: StatsBundle | null): {
  current: number | null;
  previous: number | null;
  periodUsers: boolean;
} {
  const periodUsers = readPeriodUsers(bundle);
  if (periodUsers) {
    return {
      current: periodUsers.current,
      previous: typeof periodUsers.previous === "number" ? periodUsers.previous : null,
      periodUsers: true
    };
  }
  return {
    current: total(ga4(bundle, "daily", "current"), "users"),
    previous: total(ga4(bundle, "daily", "previous"), "users"),
    periodUsers: false
  };
}

/** 회사 이름이 아닌 검색어의 클릭 합. 검색어 행이 하나도 없으면 null */
function genericClicksOf(bundle: StatsBundle | null, when: When): number | null {
  const rows = pickRows(bundle, "query", SEARCH_SOURCES, when);
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) {
    const query = row.key?.trim();
    if (!query || isBrandQuery(query) || typeof row.clicks !== "number") continue;
    sum += row.clicks;
  }
  return sum;
}

/** 워크·인사이트 상세 글인가. 국문은 접두어가 없고 영문만 /en 으로 시작한다 */
function isArticlePath(raw: string): boolean {
  let path = raw.split("?")[0].split("#")[0].trim();
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/en") return false;
  if (path.startsWith("/en/")) path = path.slice(3);
  return /^\/(works|insight)\/[^/]+$/.test(path);
}

/**
 * 검색으로 온 방문 중 워크·인사이트 글에서 시작한 비율 (0~1).
 * 들어온 페이지를 모르는 방문((not set)·빈 값)은 분모에서도 뺀다.
 */
function searchToArticleOf(bundle: StatsBundle | null, when: When): number | null {
  let search = 0;
  let article = 0;
  for (const row of ga4(bundle, "landing_channel", when)) {
    if (row.key2?.trim() !== SEARCH_CHANNEL || typeof row.sessions !== "number") continue;
    const path = row.key?.trim() ?? "";
    if (!path.startsWith("/")) continue;
    search += row.sessions;
    if (isArticlePath(path)) article += row.sessions;
  }
  return search > 0 ? article / search : null;
}

export type SummaryCard = {
  id: SummaryCardId;
  /** 없으면 null — 화면은 「—」로 그린다 */
  value: string | null;
  delta: string | null;
  tone: DeltaTone;
  previous: string | null;
  /** 방문자 카드만 — 기간 전체를 한 번 센 값인지 */
  periodUsers?: boolean;
};

export function buildSummaryCards(bundle: StatsBundle | null): SummaryCard[] {
  const visits = visitsOf(bundle);
  const generic = genericClicksOf(bundle, "current");
  const genericPrev = genericClicksOf(bundle, "previous");
  const rate = searchToArticleOf(bundle, "current");
  const ratePrev = searchToArticleOf(bundle, "previous");
  const pct = (value: number | null) => pctText(value)?.replace(/%$/, "") ?? null;

  return [
    {
      id: "visit",
      value: intText(visits.current),
      ...makeDelta(
        visits.current,
        visits.previous,
        "ratio",
        true,
        withUnit(intText(visits.previous), "visit")
      ),
      periodUsers: visits.periodUsers
    },
    {
      id: "genericClick",
      value: intText(generic),
      ...makeDelta(generic, genericPrev, "ratio", true, withUnit(intText(genericPrev), "genericClick"))
    },
    {
      id: "searchToArticle",
      value: pct(rate),
      ...makeDelta(rate, ratePrev, "point", true, withUnit(pct(ratePrev), "searchToArticle"))
    }
  ];
}

/* ─────────────────────── 방문자 추이 ─────────────────────── */

/** 실선 이번 기간, 점선 앞 기간. 같은 순번 날짜끼리 맞춘다 */
export function buildTrend(bundle: StatsBundle | null): StatsRow[] {
  const current = [...ga4(bundle, "daily", "current")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate);
  if (current.length === 0) return [];

  const previous = [...ga4(bundle, "daily", "previous")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate);

  return current.map((row, index) => ({
    date: shortDate(row.date),
    current: row.users as number,
    previous: previous[index]?.users ?? null
  }));
}

/* ─────────────────────── 루나 총평 · 할 일에 넘길 숫자 ─────────────────────── */

/** 0~1 비율 → 사람이 읽는 백분율 숫자 (56 · 4.4) */
function ratePct(rate: number | null, digits = 1): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const factor = 10 ** digits;
  return Math.round(rate * 100 * factor) / factor;
}

/** 초 → 「1분 12초」. 루나에게 넘길 때만 쓴다 */
function durationKo(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const all = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(all / 60);
  const rest = all % 60;
  if (minutes <= 0) return `${rest}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
}

type Pair<T = number> = { current: T | null; previous: T | null };

export type SummaryBriefFacts = {
  from: string;
  to: string;
  /** 방문자가 기간 전체를 한 번 센 값이면 period, 날짜별 합이면 daily_sum */
  visitsBasis: "period" | "daily_sum";
  visits: Pair;
  genericClicks: Pair;
  /** 검색으로 온 방문 중 글로 바로 들어온 비율 (%) */
  searchToArticleRate: Pair;
  impressions: Pair;
  clicks: Pair;
  /** 검색 클릭률 (%). 노출이 있을 때만 */
  clickRate: Pair;
  /** 이탈률 (%). 소수 0.56 이 아니라 56 */
  bounceRate: Pair;
  /** 참여율 (%) */
  engagementRate: Pair;
  /** 평균 세션 시간 — 「1분 12초」 문자열 */
  avgEngagementTime: Pair<string>;
  /** 앞 기간이 오픈 전(옛 사이트)이라 앞 기간 값을 모두 비웠는지 */
  previousIsOldSite: boolean;
  channels: { name: string; sessions: number }[];
  queries: { name: string; impressions: number; clicks: number; clickRate: number | null }[];
  pages: { path: string; views: number }[];
};

/** 검색어 — 노출 많은 순 다섯 개. 고른 기간의 날짜 행만 쓴다 */
function topQueries(bundle: StatsBundle | null): SummaryBriefFacts["queries"] {
  const map = new Map<string, { impressions: number; clicks: number }>();
  for (const row of pickRows(bundle, "query", SEARCH_SOURCES, "current")) {
    const key = row.key?.trim();
    if (!key) continue;
    const bucket = map.get(key) ?? { impressions: 0, clicks: 0 };
    if (typeof row.impressions === "number") bucket.impressions += row.impressions;
    if (typeof row.clicks === "number") bucket.clicks += row.clicks;
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 5)
    .map(([name, value]) => ({
      name,
      impressions: value.impressions,
      clicks: value.clicks,
      clickRate: value.impressions > 0 ? ratePct(value.clicks / value.impressions) : null
    }));
}

/**
 * 루나에게 넘길 숫자·이름만 뽑는다. 본문·긴 설명은 넣지 않는다.
 *
 * 새 사이트 숫자만 넘긴다.
 *   · 고른 기간이 통째로 오픈 전이면 null — 루나를 부르지 않는다.
 *   · 앞 기간에 오픈 전 날짜가 들어 있으면 앞 기간 값은 모두 비운다.
 */
export function buildSummaryBriefFacts(
  bundle: StatsBundle | null,
  from: string,
  to: string
): SummaryBriefFacts | null {
  if (!bundle) return null;

  const launch = readLaunchDate(bundle) ?? SITE_LAUNCH_DATE;
  const range = readActualRange(bundle);
  const actualFrom = range?.actualFrom ?? from;
  const actualTo = range?.actualTo ?? to;
  const prevFrom = range?.prevFrom ?? null;
  if (launch && actualTo < launch) return null;
  const previousIsOldSite = launch
    ? (range?.prevIncludesPreLaunch ?? (prevFrom != null && prevFrom < launch))
    : false;
  const prev = <T>(value: T | null): T | null => (previousIsOldSite ? null : value);

  const daily = ga4(bundle, "daily", "current");
  const dailyPrev = ga4(bundle, "daily", "previous");
  const gsc = pickRows(bundle, "daily", SEARCH_SOURCES, "current");
  const gscPrev = pickRows(bundle, "daily", SEARCH_SOURCES, "previous");

  const visits = visitsOf(bundle);
  const impressions = total(gsc, "impressions");
  if (visits.current == null && impressions == null) return null;

  const impressionsPrev = total(gscPrev, "impressions");
  const clicks = total(gsc, "clicks");
  const clicksPrev = total(gscPrev, "clicks");
  const engaged = weighted(daily, "engagement_rate", "sessions");
  const engagedPrev = weighted(dailyPrev, "engagement_rate", "sessions");
  const clickRate = (imp: number | null, clk: number | null) =>
    imp != null && imp > 0 && clk != null ? ratePct(clk / imp) : null;

  return {
    from: actualFrom,
    to: actualTo,
    visitsBasis: visits.periodUsers ? "period" : "daily_sum",
    visits: { current: visits.current, previous: prev(visits.previous) },
    genericClicks: {
      current: genericClicksOf(bundle, "current"),
      previous: prev(genericClicksOf(bundle, "previous"))
    },
    searchToArticleRate: {
      current: ratePct(searchToArticleOf(bundle, "current")),
      previous: prev(ratePct(searchToArticleOf(bundle, "previous")))
    },
    impressions: { current: impressions, previous: prev(impressionsPrev) },
    clicks: { current: clicks, previous: prev(clicksPrev) },
    clickRate: {
      current: clickRate(impressions, clicks),
      previous: prev(clickRate(impressionsPrev, clicksPrev))
    },
    bounceRate: {
      current: engaged == null ? null : ratePct(1 - engaged),
      previous: prev(engagedPrev == null ? null : ratePct(1 - engagedPrev))
    },
    engagementRate: { current: ratePct(engaged), previous: prev(ratePct(engagedPrev)) },
    avgEngagementTime: {
      current: durationKo(weighted(daily, "avg_seconds", "sessions")),
      previous: prev(durationKo(weighted(dailyPrev, "avg_seconds", "sessions")))
    },
    previousIsOldSite,
    channels: ranked(sumByKey(ga4(bundle, "channel", "current"), "sessions"))
      .slice(0, 5)
      .map((item) => ({ name: item.name, sessions: item.value })),
    queries: topQueries(bundle),
    pages: ranked(sumByKey(ga4(bundle, "page", "current"), "views"))
      .slice(0, 5)
      .map((item) => ({ path: item.name, views: item.value }))
  };
}

/** 같은 기간·같은 숫자면 캐시 키를 같게 한다 */
export function summaryBriefFingerprint(facts: SummaryBriefFacts): string {
  return JSON.stringify(facts);
}
