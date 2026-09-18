/**
 * Gap → 할 일 후보 → 하루 예산 안에서 고르기.
 * 1순위 모드 A 검색 검증 · 2순위 실패 · 3순위 나머지.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyGap, StudyMethod } from "@/lib/luna/study-health-meta";
import { scanStudyGaps } from "@/lib/luna/study-scan";
import {
  MODE_A_BATCH_SIZE,
  MODE_A_MINUTES,
  MODE_A_PAGE_LIMIT,
  MISS_CAUSE_LABEL,
  type MissCauseKind
} from "@/lib/luna/probe-retrieval";
import {
  isMultiSourceModeAEnabled,
  MODE_A_MULTI_MINUTES,
  MODE_A_SOURCE_BUDGET
} from "@/lib/luna/probe-mode-a-sources";

export type AgendaCandidate = {
  id: string;
  agenda: string;
  why: string;
  expected: string;
  kind: StudyMethod;
  scope: Record<string, unknown>;
  minutes: number;
  verifiable: boolean;
  score: number;
  gap_id: string;
  human_failure: boolean;
  /** 선정 티어: 1=모드A 강제 · 2=실패 · 3=나머지 */
  tier: 1 | 2 | 3;
};

export type SelectedAgenda = AgendaCandidate & {
  excluded: boolean;
  when: "tonight" | "tomorrow";
};

export type AgendaDemote = {
  id: string;
  agenda: string;
  reason: "already_ran" | "recent_fail" | "no_change_streak";
  detail: string;
  started_at?: string;
  outcome?: string | null;
  error?: string | null;
};

export const STUDY_BUDGET_MINUTES = 60;
export const STUDY_DAILY_COST_USD = 1;

export const MODE_A_AGENDA =
  "검색이 자기 자료를 찾는지 시험(모드 A)";

function minutesFor(gap: StudyGap): number {
  if (gap.method === "probe_retrieval") {
    if (gap.scope?.mode === "answer_key") return MODE_A_MINUTES;
    return Math.min(25, 8 + Math.ceil(gap.count / 20));
  }
  if (gap.method === "materialize_secondary") return 40;
  if (gap.method === "refresh_stale") return 30;
  return Math.min(20, 5 + Math.ceil(gap.count / 50));
}

function agendaFromGap(gap: StudyGap): AgendaCandidate {
  const isModeA =
    gap.method === "probe_retrieval" && gap.scope?.mode === "answer_key";
  const agenda = isModeA
    ? MODE_A_AGENDA
    : gap.method === "probe_retrieval"
      ? `${gap.table} 기준으로 검색이 자기 자료를 찾는지 시험`
      : gap.method === "materialize_secondary"
        ? `2차 데이터가 얇은 범위를 다시 묶기`
        : gap.method === "refresh_stale"
          ? `1차 색인 공백(properties·관계)을 대기열에 넣기`
          : `${gap.table} 부족함을 수치로 정리`;

  const expected = isModeA
    ? `문서 ${MODE_A_BATCH_SIZE}건/청크 · 하루 목표 ${MODE_A_PAGE_LIMIT} · 문서당 질문 3`
    : gap.method === "probe_retrieval"
      ? "실패 질문은 사람 확인(모드 B) — 자동 채점 없음"
      : gap.method === "materialize_secondary"
        ? "연결 건수·애매 건수가 늘어나는지 확인"
        : gap.method === "refresh_stale"
          ? "properties null·관계 변경 페이지가 대기열에 들어가는지 확인"
          : "부족함 규모와 다음 액션이 문장으로 남음";

  let score = gap.impact;
  if (gap.human_failure) score += 1000;
  if (gap.verifiable) score += 400;

  const tier: 1 | 2 | 3 = isModeA ? 1 : gap.human_failure ? 2 : 3;

  return {
    id: gap.id,
    agenda,
    why: gap.signal,
    expected,
    kind: gap.method,
    scope: gap.scope,
    minutes: minutesFor(gap),
    verifiable: gap.verifiable,
    score,
    gap_id: gap.id,
    human_failure: gap.human_failure,
    tier
  };
}

/** 매일 1순위 — 정답 기반 검색 검증 */
export function buildForcedModeACandidate(): AgendaCandidate {
  const multi = isMultiSourceModeAEnabled();
  return {
    id: "forced:probe_answer_key",
    agenda: MODE_A_AGENDA,
    why: multi
      ? "1차 여섯 원천(용어·이미지·지식·위키·Work·노션)을 하루 예산으로 채점한다."
      : "매일 정답 문서 기준으로 검색을 채점한다. 자동으로 배울 수 있는 유일한 슬롯이다.",
    expected: multi
      ? `용어${MODE_A_SOURCE_BUDGET.glossary.daily_items} · 이미지${MODE_A_SOURCE_BUDGET.image.daily_items} · 지식${MODE_A_SOURCE_BUDGET.knowledge.daily_items} · 위키${MODE_A_SOURCE_BUDGET.wiki.daily_items} · Work${MODE_A_SOURCE_BUDGET.work.daily_items} · 노션${MODE_A_SOURCE_BUDGET.notion.daily_items}`
      : `문서 ${MODE_A_BATCH_SIZE}건/청크 · 하루 목표 ${MODE_A_PAGE_LIMIT} · 문서당 질문 3`,
    kind: "probe_retrieval",
    scope: multi
      ? {
          mode: "answer_key",
          multi_source: true,
          forced: true
        }
      : {
          mode: "answer_key",
          page_limit: MODE_A_BATCH_SIZE,
          daily_target: MODE_A_PAGE_LIMIT,
          multi_source: false,
          forced: true
        },
    minutes: multi ? MODE_A_MULTI_MINUTES : MODE_A_MINUTES,
    verifiable: true,
    score: 1_000_000,
    gap_id: "forced:probe_answer_key",
    human_failure: false,
    tier: 1
  };
}

type RunHist = {
  kind: string;
  agenda: string;
  outcome: string | null;
  started_at: string;
  finished_at: string | null;
  result?: Record<string, unknown> | null;
};

async function loadRecentRuns(admin: SupabaseClient): Promise<RunHist[]> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("kind, agenda, outcome, started_at, finished_at, result")
    .order("started_at", { ascending: false })
    .limit(120);
  if (error || !data) return [];
  return data as RunHist[];
}

function demoteKey(c: AgendaCandidate): string {
  return `${c.kind}::${c.gap_id}`;
}

export function kstDayKey(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function todayKstKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function alreadyRanToday(c: AgendaCandidate, runs: RunHist[]): RunHist | null {
  const today = todayKstKey();
  return (
    runs.find(
      (r) =>
        r.agenda === c.agenda &&
        kstDayKey(r.started_at) === today &&
        r.outcome != null
    ) ?? null
  );
}

function kstClock(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function runError(r: RunHist): string | null {
  const err = (r.result as { error?: unknown } | null)?.error;
  return typeof err === "string" && err.trim() ? err.trim() : null;
}

function describeDemote(c: AgendaCandidate, runs: RunHist[]): AgendaDemote | null {
  const todayHit = alreadyRanToday(c, runs);
  if (todayHit) {
    const clock = kstClock(todayHit.started_at);
    const err = runError(todayHit);
    const failBit =
      todayHit.outcome === "failed"
        ? err
          ? ` (${err.includes("Timeout") || err.includes("타임아웃") ? "300초 타임아웃으로 실패" : err})`
          : " (실패)"
        : "";
    const label = c.kind === "probe_retrieval" ? "모드 A" : c.agenda;
    return {
      id: c.id,
      agenda: c.agenda,
      reason: "already_ran",
      detail: `오늘 ${clock || "05:00"} 에 ${label} 가 이미 한 번 돌았습니다${failBit}. 같은 날 같은 아젠다를 두 번 고르지 않습니다.`,
      started_at: todayHit.started_at,
      outcome: todayHit.outcome,
      error: err
    };
  }
  const key = demoteKey(c);
  const related = runs.filter(
    (r) => `${r.kind}::${c.gap_id}` === key || r.agenda === c.agenda
  );
  const failed = related.find((r) => r.outcome === "failed");
  if (failed) {
    const t = new Date(failed.started_at).getTime();
    if (Date.now() - t < 14 * 86400000) {
      const err = runError(failed);
      return {
        id: c.id,
        agenda: c.agenda,
        reason: "recent_fail",
        detail: `최근 실패로 14일 동안 다시 고르지 않습니다${err ? ` · ${err}` : ""}.`,
        started_at: failed.started_at,
        outcome: failed.outcome,
        error: err
      };
    }
  }
  const recent = related.filter((r) => r.outcome === "no_change").slice(0, 3);
  if (recent.length >= 3) {
    const days = new Set(
      recent.map((r) => new Date(r.started_at).toISOString().slice(0, 10))
    );
    if (days.size >= 3) {
      return {
        id: c.id,
        agenda: c.agenda,
        reason: "no_change_streak",
        detail: "사흘 연속 변화가 없어 건너뜁니다."
      };
    }
  }
  return null;
}

/** 직전 모드 A miss 분류 → 다음날 아젠다 후보 */
function candidatesFromMissTaxonomy(runs: RunHist[]): AgendaCandidate[] {
  const today = todayKstKey();
  const recent = runs.find((r) => {
    if (r.kind !== "probe_retrieval") return false;
    if (kstDayKey(r.started_at) === today) return false;
    const mode = (r.result as { mode?: string } | null)?.mode;
    return mode === "answer_key";
  });
  if (!recent?.result) return [];
  const byCause = (recent.result as { miss_by_cause?: Record<string, number> })
    .miss_by_cause;
  if (!byCause || typeof byCause !== "object") return [];

  const out: AgendaCandidate[] = [];
  for (const [kind, count] of Object.entries(byCause)) {
    if (!count || count < 1) continue;
    const label =
      MISS_CAUSE_LABEL[kind as MissCauseKind] ?? kind;
    const followKind =
      kind === "proper_noun_body_only"
        ? ("refresh_stale" as const)
        : kind === "weak_embedding"
          ? ("refresh_stale" as const)
          : ("inspect_gap" as const);
    out.push({
      id: `miss_followup:${kind}`,
      agenda:
        kind === "proper_noun_body_only"
          ? "고유명사 추출 → 용어·지식 후보"
          : kind === "weak_embedding"
            ? "검색 miss — 재색인 대기열"
            : `검색 miss — ${label}`,
      why: `직전 모드 A 에서 ${label} ${count}건`,
      expected:
        kind === "proper_noun_body_only"
          ? "본문 고유명사 → 용어 후보 → 지식후보"
          : kind === "wrong_label"
            ? "시험 대상에서 제외"
            : "원인별 색인·청크·임베딩 보강 후보",
      kind: followKind,
      scope: { miss_cause: kind, count, from_run: recent.started_at },
      minutes: 15,
      verifiable: kind === "weak_embedding" || kind === "proper_noun_body_only",
      score: 200 + count * 5,
      gap_id: `miss_followup:${kind}`,
      human_failure: kind === "other" || kind === "wrong_label",
      tier: 2
    });
  }
  const workMiss = (recent.result as { work_miss?: number }).work_miss;
  if (typeof workMiss === "number" && workMiss >= 3) {
    out.push({
      id: "miss_followup:work_trigram",
      agenda: "Work miss 누적 — 임베딩 전환 근거",
      why: `직전 모드 A Work miss ${workMiss}건 (trigram 한계)`,
      expected: "임베딩 on/off 결정 자료",
      kind: "inspect_gap",
      scope: { work_miss: workMiss, from_run: recent.started_at },
      minutes: 10,
      verifiable: false,
      score: 250 + workMiss,
      gap_id: "miss_followup:work_trigram",
      human_failure: true,
      tier: 2
    });
  }
  return out;
}

export async function buildAgendaCandidates(
  admin: SupabaseClient
): Promise<{ gaps: StudyGap[]; candidates: AgendaCandidate[] }> {
  const { gaps } = await scanStudyGaps(admin);
  const runs = await loadRecentRuns(admin);
  const fromGaps = gaps.map(agendaFromGap);
  const fromMiss = candidatesFromMissTaxonomy(runs);
  return { gaps, candidates: [...fromGaps, ...fromMiss] };
}

export async function selectTonightAgenda(
  admin: SupabaseClient,
  opts?: {
    budgetMinutes?: number;
    excludedIds?: Set<string>;
  }
): Promise<{
  gaps: StudyGap[];
  candidates: AgendaCandidate[];
  selected: SelectedAgenda[];
  demoted: AgendaDemote[];
}> {
  const budget = opts?.budgetMinutes ?? STUDY_BUDGET_MINUTES;
  const excluded = opts?.excludedIds ?? new Set<string>();
  const { gaps, candidates } = await buildAgendaCandidates(admin);
  const runs = await loadRecentRuns(admin);
  const demoted: AgendaDemote[] = [];

  const forced = buildForcedModeACandidate();
  const pool = [forced, ...candidates.filter((c) => c.id !== forced.id)];

  const ranked = [...pool].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.verifiable !== b.verifiable) return a.verifiable ? -1 : 1;
    return b.score - a.score;
  });

  const selected: SelectedAgenda[] = [];
  let used = 0;
  let modeAPlaced = false;

  for (const c of ranked) {
    if (excluded.has(c.id)) {
      selected.push({ ...c, excluded: true, when: "tonight" });
      continue;
    }
    const demote = describeDemote(c, runs);
    if (demote) {
      demoted.push(demote);
      continue;
    }
    if (!c.verifiable) {
      selected.push({ ...c, excluded: false, when: "tomorrow" });
      continue;
    }
    // 모드 A 는 예산과 무관하게 하루 하나 확보 (이미 오늘 돌았으면 demote)
    if (c.tier === 1 && !modeAPlaced) {
      selected.push({ ...c, excluded: false, when: "tonight" });
      used += c.minutes;
      modeAPlaced = true;
      continue;
    }
    if (used + c.minutes > budget) continue;
    selected.push({ ...c, excluded: false, when: "tonight" });
    used += c.minutes;
  }

  return { gaps, candidates: pool, selected, demoted };
}
