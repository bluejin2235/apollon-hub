/**
 * 통계 화면들이 함께 쓰는 계산 도우미.
 *
 * 규칙 하나 — 값이 없으면 null 로 둔다. 0 으로 바꾸지 않는다.
 * null 을 0 으로 바꾸면 진짜 0 인지 아직 안 걷힌 것인지 구분할 수 없다.
 * 「—」로 바꾸는 일은 화면 그리는 자리에서 dash() 로 한다.
 */

import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

export type StatsMetric = Extract<
  keyof StatsPoint,
  | "users"
  | "new_users"
  | "sessions"
  | "engaged_sessions"
  | "views"
  | "events"
  | "clicks"
  | "impressions"
  | "ctr"
  | "position"
  | "engagement_rate"
  | "avg_seconds"
>;

/**
 * 한 kind 안에서 어느 묶음을 볼지.
 *   current·previous  고른 기간 / 그 앞 기간의 일별 행
 *   overall           date 가 NULL 인 합계 행 — 기간과 무관하다
 */
export type StatsWhen = "current" | "previous" | "overall";

export function pickRows(
  bundle: StatsBundle | null,
  kind: string,
  source: string | readonly string[],
  when: StatsWhen = "current"
): StatsPoint[] {
  const result = bundle?.[kind];
  if (!result) return [];
  const sources = typeof source === "string" ? [source] : source;
  return result[when].filter((row) => sources.includes(row.source));
}

/** 합계 행이 담은 기간. 화면에 「2025.05.02 ~ 2026.08.29 합계」로 적는다 */
export function overallPeriod(
  bundle: StatsBundle | null,
  kind: string
): { from: string; to: string } | null {
  return bundle?.[kind]?.overall_period ?? null;
}

/** 2026-08-29 → 2026.08.29 */
export function isoText(iso: string): string {
  const [year, month, day] = iso.split("-");
  return month && day ? `${year}.${month}.${day}` : iso;
}

/** 「2025.05.02 ~ 2026.08.29 합계」 */
export function periodText(period: { from: string; to: string } | null): string | null {
  return period ? `${isoText(period.from)} ~ ${isoText(period.to)} 합계` : null;
}

/* ─────────────────────── 새 사이트 공개 시점 ─────────────────────── */

/**
 * 새 사이트를 공개한 날. 이 앞은 원페이지 시절이다.
 * 아직 안 정해졌으면 값이 없고, 그러면 세로선을 긋지 않는다.
 */
export const SITE_LAUNCH_DATE: string | null =
  process.env.NEXT_PUBLIC_SITE_LAUNCH_DATE?.trim() || null;

/**
 * 날짜 축 그래프에 그을 세로선.
 *
 * recharts 는 가로축이 글자 축이라 data 안에 실제로 있는 값을 줘야 한다.
 * 그래서 공개일 이후 첫 행을 찾아 그 행의 축 이름을 그대로 쓴다.
 * 공개일이 고른 기간 밖이면 null 이고 선은 그려지지 않는다.
 */
export function launchMark(
  rows: StatsPoint[],
  xOf: (row: StatsPoint) => string = (row) => shortDate(row.date)
): { x: string; label: string } | null {
  if (!SITE_LAUNCH_DATE) return null;

  const sorted = [...rows].filter((row) => row.date).sort(byDate);
  if (sorted.length === 0) return null;

  const hit = sorted.find((row) => row.date >= SITE_LAUNCH_DATE);
  // 공개일이 기간보다 뒤면 그을 자리가 없다
  if (!hit) return null;
  // 공개일이 기간보다 앞이면 전부 새 사이트다. 첫 칸에 선을 긋지 않는다
  if (sorted[0].date >= SITE_LAUNCH_DATE) return null;

  return { x: xOf(hit), label: "새 사이트 공개" };
}

/** 값이 하나도 없으면 null. 있으면 합계 */
export function sumField(rows: StatsPoint[], field: StatsMetric): number | null {
  let sum = 0;
  let seen = false;
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "number") continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/** 비율·순위는 더하면 안 된다. 무게를 실어 평균한다 */
export function weightedField(
  rows: StatsPoint[],
  field: StatsMetric,
  weight: StatsMetric
): number | null {
  let acc = 0;
  let mass = 0;
  for (const row of rows) {
    const value = row[field];
    const w = row[weight];
    if (typeof value !== "number" || typeof w !== "number" || w <= 0) continue;
    acc += value * w;
    mass += w;
  }
  return mass > 0 ? acc / mass : null;
}

export function byDate(a: StatsPoint, b: StatsPoint): number {
  return a.date.localeCompare(b.date);
}

/** 2026-08-25 → 8/25 */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(month)}/${Number(day)}`;
}

/** 막대 옆 이름 칸은 좁다. 넘치면 잘라 준다 */
export function clip(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function intText(value: number | null): string | null {
  return value == null ? null : Math.round(value).toLocaleString("ko-KR");
}

export function pctText(value: number | null, digits = 0): string | null {
  return value == null ? null : `${(value * 100).toFixed(digits)}%`;
}

export function numText(value: number | null, digits = 1): string | null {
  return value == null ? null : value.toFixed(digits);
}

/** 화면에 낼 때만 「—」로 바꾼다 */
export function dash(value: string | null): string {
  return value ?? "—";
}

export type DeltaTone = "up" | "down" | "flat";

/**
 * 지난 기간 값이 이보다 작으면 증감률을 숨긴다.
 * 분모가  Tiny 하면 ▲7099% 같은 뜻이 없는 숫자가 나온다.
 */
export const DELTA_MIN_PREVIOUS = 10;

/** ratio 증감이 이 % 를 넘으면 분모가 너무 작아 뜻이 없다 */
export const DELTA_MAX_RATIO_PERCENT = 500;

/**
 * 변화 한 줄.
 *   ratio  배수 변화 — 방문이 26% 늘었다
 *   point  비율 자체의 차이 — 이탈률 19%p
 *   abs    값 자체의 차이 — 평균 순위 1.3
 *
 * ratio 에서 지난 값이 0 이거나 DELTA_MIN_PREVIOUS 미만이거나,
 * 증감이 DELTA_MAX_RATIO_PERCENT 를 넘으면 「비교할 기간 없음」.
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  mode: "ratio" | "point" | "abs",
  higherIsBetter: boolean
): { delta: string | null; tone: DeltaTone } {
  if (current == null || previous == null) return { delta: null, tone: "flat" };

  if (mode === "ratio") {
    if (previous < DELTA_MIN_PREVIOUS) {
      return { delta: "비교할 기간 없음", tone: "flat" };
    }
  }

  const diff = current - previous;
  const rising = diff > 0;
  const good = rising === higherIsBetter;

  if (mode === "abs") {
    const size = Math.abs(diff);
    if (size < 0.05) return { delta: "0", tone: "flat" };
    return { delta: `${rising ? "▲" : "▼"} ${size.toFixed(1)}`, tone: good ? "up" : "down" };
  }

  const size = mode === "ratio" ? Math.abs(diff / previous) * 100 : Math.abs(diff) * 100;
  const rounded = Math.round(size);
  const unit = mode === "ratio" ? "%" : "%p";
  if (mode === "ratio" && rounded > DELTA_MAX_RATIO_PERCENT) {
    return { delta: "비교할 기간 없음", tone: "flat" };
  }
  if (rounded === 0) return { delta: `0${unit}`, tone: "flat" };

  return { delta: `${rising ? "▲" : "▼"} ${rounded}${unit}`, tone: good ? "up" : "down" };
}

/** KPI 카드 안 작은 추이선. 두 점 미만이면 빈 배열 — 선이 그려지지 않는다 */
export function sparkOf(
  rows: StatsPoint[],
  field: StatsMetric
): { i: number; v: number }[] {
  const points = [...rows]
    .filter((row) => typeof row[field] === "number")
    .sort(byDate)
    .map((row, index) => ({ i: index, v: row[field] as number }));
  return points.length > 1 ? points : [];
}

export function sumByKey(rows: StatsPoint[], field: StatsMetric): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "number") continue;
    const key = row.key?.trim() || "(없음)";
    map.set(key, (map.get(key) ?? 0) + value);
  }
  return map;
}

export function ranked(map: Map<string, number>): { name: string; value: number }[] {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
