export type StudyOutcome = "improved" | "no_change" | "failed" | null;

/** Stored outcomes describe execution; none currently carry a before/after quality comparison. */
export function studyOutcomeLabel(
  outcome: StudyOutcome,
  result: Record<string, unknown> = {}
): string {
  if (outcome === "failed") return "실행 실패";
  if (result.timed_out || result.ask_human) return "확인 필요";
  if (outcome === "improved") return "효과 미검증";
  if (outcome === "no_change") return "변경 없음";
  return "미완료";
}

/** Repeated questions across sources/runs cannot be divided by a Notion document count. */
export function studyQuestionAttempts(runs: Array<{
  id: string;
  kind: string;
  result: Record<string, unknown>;
}>): number {
  const seen = new Set<string>();
  let attempts = 0;
  for (const run of runs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    if (run.kind !== "probe_retrieval" || run.result.mode === "failure_review") continue;
    const count = run.result.probed;
    if (typeof count === "number" && Number.isSafeInteger(count) && count > 0) attempts += count;
  }
  return attempts;
}

export function studyActivitySummary(
  runs: Parameters<typeof studyQuestionAttempts>[0],
  notionTotal: number | null
): { value: string; pct: null; detail: string } {
  const attempts = studyQuestionAttempts(runs);
  return {
    value: `조회된 실행 기록의 시험 문항 ${attempts.toLocaleString("ko-KR")}회 · 반복 포함`,
    pct: null,
    detail: `현재 노션 문서 ${notionTotal === null ? "미확인" : `${notionTotal.toLocaleString("ko-KR")}개`}. 여러 원천의 시험 횟수이며, 고유 문서 검증률과 남은 기간은 아직 측정되지 않았습니다.`
  };
}
