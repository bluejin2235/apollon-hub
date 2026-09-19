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

export function formatFoundWeekLabel(stats: {
  total: number;
  found_count: number;
  pct: number | null;
}): string {
  if (stats.total === 0) return "이번 주 찾음 — (아직 없음)";
  const pct = stats.pct ?? 0;
  return `이번 주 찾음 ${pct}% (${stats.total}건 중 ${stats.found_count}건)`;
}
