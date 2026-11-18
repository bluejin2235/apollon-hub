/**
 * 11-18 새로 모으기 시작한 자료로 「준비 중」 칸을 채운다.
 *   page_engagement — 글별 평균 머문 시간 (콘텐츠 표)
 *   query_page      — 이 글로 들어온 검색어 (콘텐츠 펼침)
 *   hourly          — 요일과 시간대 (방문 패턴)
 * 자료가 아직 없으면(옛 홈페이지 응답 · 수집 전 기간) null 을 돌려주고, 화면은 「준비 중」을 그대로 둔다.
 */

import { pickRows } from "@/components/website/stats/stats-data";
import { ga4, normalizePath, SEARCH_SOURCES, type When } from "@/components/website/stats-v3/v3-data";
import type { StatsBundle } from "@/lib/website/stats";

/* ─────────────────────── 글별 평균 머문 시간 ─────────────────────── */

/**
 * 경로 → 평균 참여 시간(초). 날짜별 값(그날 참여 시간 ÷ 그날 활성 사용자)을 사용자 수로 가중 평균한다.
 * 기간 고유 사용자 기준이 아니라 「일별 활성 사용자당 평균」이다.
 * page_engagement 행이 하나도 없으면 null.
 */
export function dwellByPath(bundle: StatsBundle | null): Map<string, number> | null {
  const rows = ga4(bundle, "page_engagement", "current");
  if (rows.length === 0) return null;
  const acc = new Map<string, { sum: number; weight: number }>();
  for (const row of rows) {
    const path = normalizePath(row.key);
    if (!path || typeof row.avg_seconds !== "number" || typeof row.users !== "number" || row.users <= 0) continue;
    const prev = acc.get(path) ?? { sum: 0, weight: 0 };
    prev.sum += row.avg_seconds * row.users;
    prev.weight += row.users;
    acc.set(path, prev);
  }
  const out = new Map<string, number>();
  for (const [path, value] of acc) {
    if (value.weight > 0) out.set(path, value.sum / value.weight);
  }
  return out;
}

/* ─────────────────────── 이 글로 들어온 검색어 ─────────────────────── */

export type PageQuery = { query: string; clicks: number; impressions: number };

/** query_page 행이 하나라도 있나 */
export function hasQueryPage(bundle: StatsBundle | null): boolean {
  return pickRows(bundle, "query_page", SEARCH_SOURCES, "current").length > 0;
}

/** 이 경로로 구글 검색에서 들어온 검색어 — 클릭, 그다음 노출이 많은 순 */
export function queriesForPath(bundle: StatsBundle | null, path: string, limit = 5): PageQuery[] {
  const target = normalizePath(path);
  if (!target) return [];
  const byQuery = new Map<string, PageQuery>();
  for (const row of pickRows(bundle, "query_page", SEARCH_SOURCES, "current")) {
    if (!row.key || normalizePath(row.key2) !== target) continue;
    const query = row.key.trim();
    const prev = byQuery.get(query) ?? { query, clicks: 0, impressions: 0 };
    prev.clicks += row.clicks ?? 0;
    prev.impressions += row.impressions ?? 0;
    byQuery.set(query, prev);
  }
  return [...byQuery.values()]
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query))
    .slice(0, limit);
}

/* ─────────────────────── 요일과 시간대 ─────────────────────── */

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
/** 3시간 8칸: 0~3시 … 21~24시 */
export const HOUR_BLOCKS = 8;

/** 2026-11-17 → 0(월)~6(일). 날짜만 보므로 시간대와 무관 */
function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (day + 6) % 7;
}

export type HourGrid = {
  /** [요일 7][3시간 8칸] 방문자 수 합 */
  cells: number[][];
  max: number;
  total: number;
};

/**
 * hourly(key = 「00」~「23」, 서울 시각) 행을 요일 × 3시간 칸으로 더한다.
 * 행이 하나도 없으면 null.
 */
export function hourGrid(bundle: StatsBundle | null, when: When = "current"): HourGrid | null {
  const rows = ga4(bundle, "hourly", when);
  if (rows.length === 0) return null;
  const cells = WEEKDAYS.map(() => Array.from({ length: HOUR_BLOCKS }, () => 0));
  let total = 0;
  for (const row of rows) {
    if (!row.date) continue;
    const hour = Number(row.key);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const value = row.users ?? 0;
    cells[weekdayIndex(row.date)][Math.floor(hour / 3)] += value;
    total += value;
  }
  const max = Math.max(0, ...cells.flat());
  return { cells, max, total };
}

/** 가장 많이 오는 칸 — 「화요일 15~18시」 */
export function peakCell(grid: HourGrid): string | null {
  if (grid.max <= 0) return null;
  for (let d = 0; d < WEEKDAYS.length; d += 1) {
    const b = grid.cells[d].indexOf(grid.max);
    if (b >= 0) return `${WEEKDAYS[d]}요일 ${b * 3}~${b * 3 + 3}시`;
  }
  return null;
}
