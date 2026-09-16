/**
 * 어젯밤 자습 실행 → 아침 리포트 문장
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyRunRow } from "@/lib/luna/study-run";

function outcomeLabel(o: StudyRunRow["outcome"]): string {
  if (o === "improved") return "나아짐";
  if (o === "no_change") return "변화 없음";
  if (o === "failed") return "실패";
  return "미완";
}

export function formatStudyRunReportLines(runs: StudyRunRow[]): string[] {
  if (runs.length === 0) return [];
  const lines: string[] = ["어젯밤 루나가 한 일"];
  let i = 1;
  for (const run of runs) {
    const result = run.result ?? {};
    const learned =
      typeof result.learned === "string" ? result.learned : null;
    const next = typeof result.next === "string" ? result.next : null;
    const probed =
      typeof result.probed === "number"
        ? result.mode === "failure_review"
          ? `${result.probed}건 사람 확인용(자동 hit/miss 없음)`
          : typeof result.hit_at_5 === "number"
            ? `${result.probed}문항 · hit@1 ${result.hit_at_1 ?? 0} · hit@5 ${result.hit_at_5 ?? 0} · miss ${result.miss ?? 0}`
            : `${result.probed}건 시험 · 못 찾음 ${result.miss ?? 0}`
        : typeof result.listed === "number"
          ? `${result.listed}건 목록`
          : typeof result.error === "string"
            ? result.error
            : outcomeLabel(run.outcome);
    lines.push(
      `${i}. ${run.agenda}\n` +
        `   왜  — ${run.why}\n` +
        `   결과 — ${probed} (${outcomeLabel(run.outcome)})` +
        (learned ? `\n   알아낸 것 — ${learned}` : "") +
        (next ? `\n   다음 — ${next}` : "")
    );
    i += 1;
  }
  const cost = runs.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const calls = runs.reduce((s, r) => s + (r.llm_calls || 0), 0);
  if (runs.some((r) => (r.result as { stopped?: boolean })?.stopped)) {
    lines.push(`비용 상한으로 일부 중단 · 합계 $${cost.toFixed(4)} · LLM ${calls}회`);
  } else {
    lines.push(`비용 $${cost.toFixed(4)} · LLM ${calls}회`);
  }
  return lines;
}

export async function collectStudyMorningLines(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("*")
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .order("started_at", { ascending: true });
  if (error) {
    console.error("[luna/study-report]", error);
    return [];
  }
  return formatStudyRunReportLines((data ?? []) as StudyRunRow[]);
}
