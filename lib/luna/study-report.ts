/**
 * 어젯밤 자습 실행 → 아침 리포트용 구조화
 * cron 자습만 카드로 쓰고, 색인 러너 기록은 색인 항목으로 분리한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyRunRow } from "@/lib/luna/study-run";
import { studyOutcomeLabel as outcomeLabel } from "@/lib/luna/study-status";

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

const MODE_A_SOURCE_LABEL: Record<string, string> = {
  glossary: "용어",
  image: "이미지",
  knowledge: "지식",
  wiki: "위키",
  work: "Work",
  notion: "노션"
};

const MODE_A_SOURCE_ORDER = [
  "glossary",
  "image",
  "knowledge",
  "wiki",
  "work",
  "notion"
] as const;

/** 하루 전량 모드 A 질문 수 — 아직 안 돈 원천은 —/N 으로 보여 준다. */
const MODE_A_EXPECTED_Q: Record<string, number> = {
  glossary: 100,
  image: 200,
  knowledge: 20,
  wiki: 45,
  work: 300,
  notion: 300
};

export type ModeAStageSnapshot = {
  source: string;
  probed: number;
  miss: number;
  hit_at_1: number | null;
  llm_calls: number;
};

export function parseModeAStages(
  result: Record<string, unknown>
): ModeAStageSnapshot[] {
  const raw = result.stages;
  if (!Array.isArray(raw)) return [];
  const out: ModeAStageSnapshot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const source = typeof s.source === "string" ? s.source : "";
    if (!source) continue;
    const probed = typeof s.probed === "number" ? s.probed : 0;
    const miss = typeof s.miss === "number" ? s.miss : 0;
    // A non-miss may be a lower-ranked hit; it does not establish rank one.
    const hit_at_1 =
      typeof s.hit_at_1 === "number" && Number.isSafeInteger(s.hit_at_1) && s.hit_at_1 >= 0
        ? s.hit_at_1
        : null;
    const llm_calls = typeof s.llm_calls === "number" ? s.llm_calls : 0;
    out.push({ source, probed, miss, hit_at_1, llm_calls });
  }
  return out;
}

export function sumModeAStages(stages: ModeAStageSnapshot[]): {
  probed: number;
  miss: number;
  hit_at_1: number | null;
  llm_calls: number;
  breakdown: string;
} {
  const probed = stages.reduce((n, s) => n + s.probed, 0);
  const miss = stages.reduce((n, s) => n + s.miss, 0);
  const hit_at_1 = stages.some((s) => s.hit_at_1 === null)
    ? null
    : stages.reduce((n, s) => n + (s.hit_at_1 ?? 0), 0);
  const llm_calls = stages.reduce((n, s) => n + s.llm_calls, 0);
  const bySource = new Map(stages.map((s) => [s.source, s]));
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const key of MODE_A_SOURCE_ORDER) {
    seen.add(key);
    const stage = bySource.get(key);
    const label = MODE_A_SOURCE_LABEL[key] ?? key;
    if (stage) {
      parts.push(`${label} ${stage.hit_at_1 ?? "—"}/${stage.probed}`);
    } else {
      const expected = MODE_A_EXPECTED_Q[key];
      parts.push(
        typeof expected === "number" ? `${label} —/${expected}` : `${label} —`
      );
    }
  }
  for (const stage of stages) {
    if (seen.has(stage.source)) continue;
    const label = MODE_A_SOURCE_LABEL[stage.source] ?? stage.source;
    parts.push(`${label} ${stage.hit_at_1 ?? "—"}/${stage.probed}`);
  }
  return { probed, miss, hit_at_1, llm_calls, breakdown: parts.join(" · ") };
}

/** 원천별 한 줄. 합계(hit_at_5)만 있으면 쓰지 않는다. */
export function formatModeAResultLine(
  result: Record<string, unknown>
): string | null {
  const stages = parseModeAStages(result);
  if (stages.length === 0 || result.mode === "failure_review") return null;
  const totals = sumModeAStages(stages);
  return `${totals.probed}건 · 못 찾음 ${totals.miss} · ${totals.breakdown}`;
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
  // 중첩 drain 만 있고 자습 본문이 없으면 색인 러너
  const drain = result.last_drain;
  if (
    drain &&
    typeof drain === "object" &&
    typeof (drain as { index_run_id?: string }).index_run_id === "string" &&
    !result.queued &&
    !result.listed
  ) {
    return true;
  }
  return false;
}

/** cron luna-selfstudy 가 돌린 자습만 */
export function isCronStudyRun(run: StudyRunRow): boolean {
  if (isIndexRunnerStudyRun(run)) return false;
  const scope = scopeOf(run);
  const result = resultOf(run);
  if (scope.trigger === "manual" || result.trigger === "manual") return false;
  if (result.queued_by === "manual") return false;
  if (scope.trigger === "cron" || result.trigger === "cron") return true;
  // 과거 실행은 trigger 필드가 비어 있음 — 색인 러너·수동이 아니면 자습으로 본다
  return true;
}

function formatDid(result: Record<string, unknown>, expected: string): string {
  if (typeof result.did === "string" && result.did.trim()) return result.did.trim();
  if (typeof result.action === "string" && result.action.trim()) return result.action.trim();
  const stages = parseModeAStages(result);
  const probed =
    stages.length > 0
      ? sumModeAStages(stages).probed
      : typeof result.probed === "number"
        ? result.probed
        : null;
  if (typeof probed === "number") {
    if (result.mode === "failure_review") {
      return `실패 표본 ${probed}건을 다시 살펴봤습니다`;
    }
    return `질문 ${probed}개를 만들어 검색에 던졌습니다`;
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
  const fromStages = formatModeAResultLine(result);
  if (fromStages) return fromStages;
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
    return `${result.listed}건 목록 (${outcomeLabel(outcome, result)})`;
  }
  if (typeof result.error === "string") return result.error;
  return outcomeLabel(outcome, result);
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
  const stages = parseModeAStages(result);
  const llmFromStages =
    stages.length > 0 ? sumModeAStages(stages).llm_calls : 0;
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
    outcomeLabel: outcomeLabel(run.outcome, result),
    cost_usd: run.cost_usd || 0,
    llm_calls: Math.max(run.llm_calls || 0, llmFromStages),
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
        : outcomeLabel(run.outcome, result),
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
  // 미완 런은 지금까지 흐른 시간으로 표시 (finished_at 없으면 1분으로 찌그러지지 않게)
  const maxEnd = ends.length
    ? Math.max(...ends)
    : Math.max(Date.now(), ...starts);
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
  // 같은 아젠다는 마지막 실행만 (중복 카드 방지)
  const latestByAgenda = new Map<string, StudyRunRow>();
  for (const run of cronRuns) {
    latestByAgenda.set(run.agenda.trim(), run);
  }
  const dedupedCron = [...latestByAgenda.values()].sort(
    (a, b) =>
      new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
  const cards = dedupedCron.map(toStudyCard);
  const indexCards = indexRuns.map(toIndexCard);
  // 소요 시간은 자습 카드만 (색인 drain 수백 분 제외)
  const { durationLabel, rangeLabel } = durationRange(dedupedCron);

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
