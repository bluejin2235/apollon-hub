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
 *   current·previous       website_stats — 지금 사이트
 *   baseline               옛 사이트 중 날짜가 있는 것 (기간으로 잘린다)
 *   baseline_overall       옛 사이트 중 날짜가 없는 것 (전체 기간 합계)
 */
export type StatsWhen = "current" | "previous" | "baseline" | "baseline_overall";

export function pickRows(
  bundle: StatsBundle | null,
  kind: string,
  source: string,
  when: StatsWhen = "current"
): StatsPoint[] {
  const result = bundle?.[kind];
  if (!result) return [];
  return result[when].filter((row) => row.source === source);
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
 * 변화 한 줄.
 *   ratio  배수 변화 — 방문이 26% 늘었다
 *   point  비율 자체의 차이 — 이탈률 19%p
 *   abs    값 자체의 차이 — 평균 순위 1.3
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  mode: "ratio" | "point" | "abs",
  higherIsBetter: boolean
): { delta: string | null; tone: DeltaTone } {
  if (current == null || previous == null) return { delta: null, tone: "flat" };
  if (mode === "ratio" && previous === 0) return { delta: null, tone: "flat" };

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
