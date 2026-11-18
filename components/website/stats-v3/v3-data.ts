/**
 * 통계 v3 — 다섯 화면이 함께 쓰는 숫자.
 *
 * 계산은 지금 화면의 함수를 그대로 쓴다. summary-data.ts 가 내보내지 않는 것
 * (visitsOf · isArticlePath · searchToArticleOf · genericClicksOf)은 고치지 않고 복사했다.
 * 지금 화면 규칙과 같다 — 값이 없으면 null 이고, 「—」로 바꾸는 일은 그리는 자리에서 한다.
 */

import { isBrandQuery } from "@/components/website/stats/search-data";
import {
  byDate,
  makeCountDelta,
  makeDelta,
  pickRows,
  previousIsOldSite,
  readActualRange,
  readLaunchDate,
  SITE_LAUNCH_DATE,
  sumField,
  weightedField,
  type DeltaView
} from "@/components/website/stats/stats-data";
import { addIsoDays, inclusiveDays } from "@/components/website/stats-v3/v3-period";
import type { PeriodUsersCompare, StatsAction, StatsBundle, StatsPoint } from "@/lib/website/stats";

export type When = "current" | "previous";

export const SEARCH_SOURCES = ["gsc", "gsc_http"] as const;
const SEARCH_CHANNEL = "Organic Search";

export function ga4(bundle: StatsBundle | null, kind: string, when: When): StatsPoint[] {
  return pickRows(bundle, kind, "ga4", when);
}

/* ─────────────── summary-data.ts 에서 복사 (내보내지 않는 함수) ─────────────── */

function readPeriodUsers(bundle: StatsBundle | null): PeriodUsersCompare | null {
  if (!bundle) return null;
  for (const result of Object.values(bundle)) {
    const value = result?.period_users;
    if (!value || typeof value !== "object") continue;
    if (typeof value.current === "number") return value;
  }
  return null;
}

/** 방문자 — 기간 전체를 한 번 센 값. 없으면 날짜별 합으로 대신한다 */
export function visitsOf(bundle: StatsBundle | null): {
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
    current: sumField(ga4(bundle, "daily", "current"), "users"),
    previous: sumField(ga4(bundle, "daily", "previous"), "users"),
    periodUsers: false
  };
}

/** 처음 온 사람 = 새 방문자, 다시 온 사람 = 전체 − 새 방문자. 기간 전체 방문자가 없으면 null */
export function newReturningOf(bundle: StatsBundle | null): {
  fresh: { current: number | null; previous: number | null };
  again: { current: number | null; previous: number | null };
} | null {
  const users = readPeriodUsers(bundle);
  if (!users) return null;
  const split = (all: number | null, fresh: number | null) =>
    typeof all === "number" && typeof fresh === "number"
      ? { fresh: Math.min(fresh, all), again: Math.max(0, all - fresh) }
      : { fresh: null, again: null };
  const cur = split(users.current, users.current_new);
  const prev = split(users.previous, users.previous_new);
  return {
    fresh: { current: cur.fresh, previous: prev.fresh },
    again: { current: cur.again, previous: prev.again }
  };
}

export function genericClicksOf(bundle: StatsBundle | null, when: When): number | null {
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
export function isArticlePath(raw: string): boolean {
  let path = raw.split("?")[0].split("#")[0].trim();
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/en") return false;
  if (path.startsWith("/en/")) path = path.slice(3);
  return /^\/(works|insight)\/[^/]+$/.test(path);
}

/** 검색으로 온 방문 중 워크·인사이트 글에서 시작한 비율 (0~1) */
export function searchToArticleOf(bundle: StatsBundle | null, when: When): number | null {
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

/* ─────────────────────── 여러 화면이 같이 쓰는 값 ─────────────────────── */

/** 글로 바로 들어온 방문 — 첫 페이지(landing)가 워크·인사이트 글인 세션 합 */
export function articleEntriesOf(bundle: StatsBundle | null, when: When): number | null {
  const rows = ga4(bundle, "landing", when);
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) {
    if (typeof row.sessions !== "number" || !row.key || !isArticlePath(row.key)) continue;
    sum += row.sessions;
  }
  return sum;
}

/** 평균 머문 시간(초) — 날짜별 평균 세션 시간을 세션 수로 무게를 실어 평균 (behavior-data buildDwellSummary 와 같은 식) */
export function dwellSecondsOf(bundle: StatsBundle | null, when: When): number | null {
  return weightedField(ga4(bundle, "daily", when), "avg_seconds", "sessions");
}

/** 그냥 나간 비율 0~1 — 1 − 참여율 (summary-data 루나 요약의 이탈률과 같은 식) */
export function bounceOf(bundle: StatsBundle | null, when: When): number | null {
  const engaged = weightedField(ga4(bundle, "daily", when), "engagement_rate", "sessions");
  return engaged == null ? null : 1 - engaged;
}

/** 한 번에 본 페이지 수 — 조회 ÷ 세션 (behavior-data buildDwellSummary 와 같은 식) */
export function pagesPerSessionOf(bundle: StatsBundle | null, when: When): number | null {
  const rows = ga4(bundle, "daily", when);
  const sessions = sumField(rows, "sessions");
  const views = sumField(rows, "views");
  return views != null && sessions != null && sessions > 0 ? views / sessions : null;
}

export function dailySumOf(
  bundle: StatsBundle | null,
  field: "sessions" | "views",
  when: When
): number | null {
  return sumField(ga4(bundle, "daily", when), field);
}

/** 앞 기간이 옛 사이트면 앞 기간 값을 비운다 — 요약 카드와 같은 기준 */
export function prevGuard(bundle: StatsBundle | null): <T>(value: T | null) => T | null {
  const oldSite = previousIsOldSite(bundle);
  return <T>(value: T | null) => (oldSite ? null : value);
}

/* ─────────────────────── 화면 글 ─────────────────────── */

export function intKo(value: number | null): string | null {
  return value == null ? null : Math.round(value).toLocaleString("ko-KR");
}

/** 초 → 목업 모양 「1분 24」+「초」. 1분이 안 되면 「42」+「초」 */
export function durationParts(seconds: number | null): { value: string; unit: string } | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const all = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(all / 60);
  const rest = all % 60;
  if (minutes === 0) return { value: String(rest), unit: "초" };
  return { value: `${minutes}분 ${String(rest).padStart(2, "0")}`, unit: "초" };
}

export function durationText(seconds: number | null): string | null {
  const parts = durationParts(seconds);
  return parts ? `${parts.value}${parts.unit}` : null;
}

/** 0~1 → 「68」 */
export function pctNumber(rate: number | null): string | null {
  return rate == null ? null : String(Math.round(rate * 100));
}

export type Pair = { current: number | null; previous: number | null };

export function ratioDelta(pair: Pair, label: (value: number | null) => string | null, higherIsBetter = true): DeltaView {
  return makeDelta(pair.current, pair.previous, "ratio", higherIsBetter, label(pair.previous));
}

export function countDeltaOf(pair: Pair, label: (value: number | null) => string | null): DeltaView {
  return makeCountDelta(pair.current, pair.previous, true, label(pair.previous));
}

/* ─────────────────────── 경로 ─────────────────────── */

export function normalizePath(raw: string | null): string | null {
  if (!raw) return null;
  let path = raw.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

export function pathLang(path: string): "ko" | "en" {
  return path === "/en" || path.startsWith("/en/") ? "en" : "ko";
}

export function langLabel(lang: "ko" | "en"): "국문" | "영문" {
  return lang === "en" ? "영문" : "국문";
}

/* ─────────────────────── 그래프 세로선 ─────────────────────── */

export type ChartMark = { index: number; labels: string[] };

/** 2026-11-11 → 11-11 */
export function markDate(iso: string): string {
  return iso.slice(5);
}

/**
 * 기간 안 조치 기록을 날짜 칸에 붙인다. 같은 날짜는 한 선에 함께 쓴다.
 * 오픈일은 그날 조치 기록이 없을 때만 「새 홈페이지 오픈」으로 더한다.
 */
export function chartMarks(
  dates: string[],
  actions: StatsAction[],
  bundle: StatsBundle | null
): ChartMark[] {
  const byIndex = new Map<number, string[]>();
  const add = (iso: string, label: string) => {
    const index = dates.indexOf(iso);
    if (index < 0) return;
    const list = byIndex.get(index) ?? [];
    list.push(`${markDate(iso)} ${label}`);
    byIndex.set(index, list);
  };
  const ordered = [...actions].sort((a, b) =>
    a.action_date === b.action_date ? a.created_at.localeCompare(b.created_at) : a.action_date.localeCompare(b.action_date)
  );
  for (const item of ordered) add(item.action_date, item.title);
  const launch = readLaunchDate(bundle) ?? SITE_LAUNCH_DATE;
  if (launch && !ordered.some((item) => item.action_date === launch)) add(launch, "새 홈페이지 오픈");
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, labels]) => ({ index, labels }));
}

/** 기간 안 조치 기록 — 날짜 이른 순 */
export function actionsInRange(actions: StatsAction[], bundle: StatsBundle | null, from: string, to: string): StatsAction[] {
  const range = readActualRange(bundle);
  const start = range?.actualFrom ?? from;
  const end = range?.actualTo ?? to;
  return actions
    .filter((item) => item.action_date >= start && item.action_date <= end)
    .sort((a, b) =>
      a.action_date === b.action_date ? a.created_at.localeCompare(b.created_at) : a.action_date.localeCompare(b.action_date)
    );
}

/** 날짜별 값 — 이번 기간 실선, 앞 기간은 같은 순번 날짜 */
export type DaySeries = { dates: string[]; current: (number | null)[]; previous: (number | null)[] };

export function daySeries(
  rows: StatsPoint[],
  previousRows: StatsPoint[],
  value: (row: StatsPoint) => number | null
): DaySeries {
  const sumByDate = (list: StatsPoint[]) => {
    const map = new Map<string, number>();
    for (const row of list) {
      if (!row.date) continue;
      const v = value(row);
      if (v == null) continue;
      map.set(row.date, (map.get(row.date) ?? 0) + v);
    }
    return map;
  };
  const cur = sumByDate(rows);
  const prev = sumByDate(previousRows);
  const dates = [...cur.keys()].sort();
  const prevValues = [...prev.keys()].sort().map((date) => prev.get(date) as number);
  return {
    dates,
    current: dates.map((date) => cur.get(date) ?? null),
    previous: dates.map((_, index) => prevValues[index] ?? null)
  };
}

/** 날짜별 행 그대로(평균값 등 더하면 안 되는 값) */
export function dayRows(rows: StatsPoint[]): StatsPoint[] {
  return [...rows].filter((row) => row.date).sort(byDate);
}

/**
 * 그래프 마우스 상자에 쓰는 앞 기간 날짜 — 이번 날짜에서 기간 길이만큼 뺀 날.
 * 응답에 비교 기간이 없으면 모두 null.
 */
export function prevDatesOf(bundle: StatsBundle | null, dates: string[]): (string | null)[] {
  const range = readActualRange(bundle);
  if (!range) return dates.map(() => null);
  const length = inclusiveDays(range.actualFrom, range.actualTo);
  return dates.map((date) => addIsoDays(date, -length));
}
