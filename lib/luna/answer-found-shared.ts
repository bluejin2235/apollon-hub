export const FOUND_REASONS = [
  "없는 것 같아요",
  "있는데 다른 게 나왔어요",
  "반만 맞아요"
] as const;

export type FoundReason = (typeof FOUND_REASONS)[number];

export function isFoundReason(v: unknown): v is FoundReason {
  return (
    typeof v === "string" &&
    (FOUND_REASONS as readonly string[]).includes(v)
  );
}

export function formatFoundBucketLabel(
  window: "7d" | "week",
  stats: { total: number; found_count: number; pct: number | null }
): string {
  const head = window === "7d" ? "최근 7일 찾음" : "이번 주 찾음";
  if (stats.total === 0) return `${head} — (아직 없음)`;
  const pct = stats.pct ?? 0;
  return `${head} ${pct}% (${stats.total}건 중 ${stats.found_count}건)`;
}

/** @deprecated 아침 리포트·대시보드는 최근 7일(formatFoundBucketLabel "7d") */
export function formatFoundWeekLabel(stats: {
  total: number;
  found_count: number;
  pct: number | null;
}): string {
  return formatFoundBucketLabel("week", stats);
}

export function formatFoundSubLabel(weekTotal: number, allTotal: number): string {
  return `이번 주 ${weekTotal}건 · 누적 ${allTotal}건`;
}
