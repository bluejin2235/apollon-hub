/**
 * 어젯밤 자습 실행 → 아침 리포트용 구조화
 * cron 자습만 카드로 쓰고, 색인 러너 기록은 색인 항목으로 분리한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyRunRow } from "@/lib/luna/study-run";

export type StudyRunReportCard = {
  agenda: string;
  why: string;
  did: string;
  result: string;
  learned: string | null;
  next: string | null;
  blocked: string | null;
  outcome: "improved" | "no_change" | "failed" | null;
  outcomeLabel: string;
  cost_usd: number;
  llm_calls: number;
  started_at: string;
  finished_at: string | null;
};

export type IndexRunReportCard = {
  agenda: string;
  did: string;
  result: string;
  processed: number | null;
  remaining: number | null;
  started_at: string;
  finished_at: string | null;
};

export type StudyMorningReport = {
  cards: StudyRunReportCard[];
  indexCards: IndexRunReportCard[];
  totalCost: number;
  totalCalls: number;
  durationLabel: string | null;
  rangeLabel: string | null;
};

function outcomeLabel(o: StudyRunRow["outcome"]): string {
  if (o === "improved") return "나아짐";
  if (o === "no_change") return "변화 없음";
  if (o === "failed") return "나빠짐";
  return "미완";
}

function scopeOf(run: StudyRunRow): Record<string, unknown> {
  return run.scope && typeof run.scope === "object" ? run.scope : {};
}

function resultOf(run: StudyRunRow): Record<string, unknown> {
  return run.result && typeof run.result === "object" ? run.result : {};
}

/** 색인 러너가 luna_study_runs 에 남긴 기록 */
export function isIndexRunnerStudyRun(run: StudyRunRow): boolean {
  const scope = scopeOf(run);
  const result = resultOf(run);
  if (typeof result.index_run_id === "string" && result.index_run_id) return true;
  if (scope.source === "luna_index_queue") return true;
  if (run.agenda.includes("대기열 갱신")) return true;
  return false;
}

/** cron luna-selfstudy 가 돌린 자습만 */
export function isCronStudyRun(run: StudyRunRow): boolean {
  if (isIndexRunnerStudyRun(run)) return false;
  const scope = scopeOf(run);
  const result = resultOf(run);
  if (scope.trigger === "cron") return true;
  if (result.trigger === "cron") return true;
  if (scope.trigger === "manual" || result.trigger === "manual") return false;
  if (result.queued_by === "manual") return false;
  return false;
}

function formatDid(result: Record<string, unknown>, expected: string): string {
  if (typeof result.did === "string" && result.did.trim()) return result.did.trim();
  if (typeof result.action === "string" && result.action.trim()) return result.action.trim();
  if (typeof result.probed === "number") {
    if (result.mode === "failure_review") {
      return `실패 표본 ${result.probed}건을 다시 살펴봤습니다`;
    }
    return `질문 ${result.probed}개를 만들어 검색에 던졌습니다`;
  }
  if (typeof result.queued === "number") {
    return `대기열에 ${result.queued}건을 넣었습니다`;
  }
  if (typeof result.listed === "number") {
    return `갱신할 ${result.listed}건을 골라 목록으로 만들었습니다`;
  }
  return expected || "실행했습니다";
}

function formatResultLine(
  result: Record<string, unknown>,
  outcome: StudyRunRow["outcome"]
): string {
  if (typeof result.result_line === "string" && result.result_line.trim()) {
    return result.result_line.trim();
  }
  if (typeof result.probed === "number") {
    if (result.mode === "failure_review") {
      return `${result.probed}건 사람 확인용(자동 hit/miss 없음)`;
    }
    if (typeof result.hit_at_5 === "number") {
      return `정답을 1위로 찾은 것 ${result.hit_at_1 ?? 0} · 5위 안 ${result.hit_at_5} · 못 찾은 것 ${result.miss ?? 0}`;
    }
    return `${result.probed}건 시험 · 못 찾음 ${result.miss ?? 0}`;
  }
  if (typeof result.queued === "number") {
    return `대기열 +${result.queued} · pending ${result.pending ?? "—"}`;
  }
  if (typeof result.listed === "number") {
    return `${result.listed}건 목록 (${outcomeLabel(outcome)})`;
  }
  if (typeof result.error === "string") return result.error;
  return outcomeLabel(outcome);
}

function formatBlocked(result: Record<string, unknown>): string | null {
  if (typeof result.blocked === "string" && result.blocked.trim()) {
    return result.blocked.trim();
  }
  if (result.needs_human === true) {
    return typeof result.human_ask === "string" && result.human_ask.trim()
      ? result.human_ask.trim()
      : "이 부분은 사람이 만들어 주셔야 합니다.";
  }
  return null;
}

function toStudyCard(run: StudyRunRow): StudyRunReportCard {
  const result = resultOf(run);
  return {
    agenda: run.agenda,
    why: run.why,
    did: formatDid(result, run.expected),
    result: formatResultLine(result, run.outcome),
    learned:
      typeof result.learned === "string" && result.learned.trim()
        ? result.learned.trim()
        : null,
    next:
      typeof result.next === "string" && result.next.trim()
        ? result.next.trim()
        : null,
    blocked: formatBlocked(result),
    outcome: run.outcome,
    outcomeLabel: outcomeLabel(run.outcome),
    cost_usd: run.cost_usd || 0,
    llm_calls: run.llm_calls || 0,
    started_at: run.started_at,
    finished_at: run.finished_at
  };
}

function toIndexCard(run: StudyRunRow): IndexRunReportCard {
  const result = resultOf(run);
  const processed =
    typeof result.processed === "number" ? result.processed : null;
  const remaining =
    typeof result.remaining === "number"
      ? result.remaining
      : typeof result.pending === "number"
        ? result.pending
        : null;
  return {
    agenda: run.agenda,
    did:
      typeof result.did === "string" && result.did.trim()
        ? result.did.trim()
        : "색인 대기열을 처리했습니다",
    result:
      typeof result.result_line === "string" && result.result_line.trim()
        ? result.result_line.trim()
        : outcomeLabel(run.outcome),
    processed,
    remaining,
    started_at: run.started_at,
    finished_at: run.finished_at
  };
}

function durationRange(runs: StudyRunRow[]): {
  durationLabel: string | null;
  rangeLabel: string | null;
} {
  if (runs.length === 0) return { durationLabel: null, rangeLabel: null };
  const starts = runs
    .map((r) => new Date(r.started_at).getTime())
    .filter((n) => !Number.isNaN(n));
  const ends = runs
    .map((r) => (r.finished_at ? new Date(r.finished_at).getTime() : NaN))
    .filter((n) => !Number.isNaN(n));
  if (!starts.length) return { durationLabel: null, rangeLabel: null };
  const minStart = Math.min(...starts);
  const maxEnd = ends.length ? Math.max(...ends) : Math.max(...starts);
  const mins = Math.max(1, Math.round((maxEnd - minStart) / 60000));
  const fmt = (ms: number) => {
    const d = new Date(ms + 9 * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  return {
    durationLabel: `${mins}분`,
    rangeLabel: `${fmt(minStart)} ~ ${fmt(maxEnd)}`
  };
}

export function buildStudyMorningReport(runs: StudyRunRow[]): StudyMorningReport {
  const cronRuns = runs.filter(isCronStudyRun);
  const indexRuns = runs.filter(isIndexRunnerStudyRun);
  const cards = cronRuns.map(toStudyCard);
  const indexCards = indexRuns.map(toIndexCard);
  const { durationLabel, rangeLabel } = durationRange(cronRuns);

  return {
    cards,
    indexCards,
    totalCost: cards.reduce((s, c) => s + c.cost_usd, 0),
    totalCalls: cards.reduce((s, c) => s + c.llm_calls, 0),
    durationLabel,
    rangeLabel
  };
}

/** @deprecated 텍스트 줄 — 새 메일에서는 buildStudyMorningReport 사용 */
export function formatStudyRunReportLines(runs: StudyRunRow[]): string[] {
  const report = buildStudyMorningReport(runs);
  if (report.cards.length === 0 && report.indexCards.length === 0) return [];
  const lines: string[] = ["어젯밤 루나가 한 일"];
  let i = 1;
  for (const card of report.cards) {
    lines.push(
      `${i}. ${card.agenda}\n` +
        `   왜  — ${card.why}\n` +
        `   한 것 — ${card.did}\n` +
        `   결과 — ${card.result}` +
        (card.learned ? `\n   알아낸 것 — ${card.learned}` : "") +
        (card.next ? `\n   다음 — ${card.next}` : "") +
        (card.blocked ? `\n   막힌 것 — ${card.blocked}` : "")
    );
    i += 1;
  }
  if (report.indexCards.length) {
    lines.push("색인");
    for (const card of report.indexCards) {
      lines.push(`· ${card.did} — ${card.result}`);
    }
  }
  lines.push(
    `LLM ${report.totalCalls}회 · $${report.totalCost.toFixed(4)}` +
      (report.durationLabel ? ` · ${report.durationLabel}` : "")
  );
  return lines;
}

export async function collectStudyRuns(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<StudyRunRow[]> {
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
  return (data ?? []) as StudyRunRow[];
}

export async function collectStudyMorningLines(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string[]> {
  const runs = await collectStudyRuns(admin, startIso, endIso);
  return formatStudyRunReportLines(runs);
}
