/**
 * Gap → 할 일 후보 → 하루 예산 안에서 고르기.
 * 1순위 모드 A 검색 검증 · 2순위 실패 · 3순위 나머지.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyGap, StudyMethod } from "@/lib/luna/study-health-meta";
import { scanStudyGaps } from "@/lib/luna/study-scan";
import {
  MODE_A_MINUTES,
  MODE_A_PAGE_LIMIT,
  MISS_CAUSE_LABEL,
  type MissCauseKind
} from "@/lib/luna/probe-retrieval";

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
    ? `문서 ${MODE_A_PAGE_LIMIT}건 · 문서당 질문 3 · hit@1·5·10·miss 분류`
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
  return {
    id: "forced:probe_answer_key",
    agenda: MODE_A_AGENDA,
    why: "매일 정답 문서 기준으로 검색을 채점한다. 자동으로 배울 수 있는 유일한 슬롯이다.",
    expected: `문서 ${MODE_A_PAGE_LIMIT}건 · 문서당 질문 3 · hit@1·5·10·miss 분류`,
    kind: "probe_retrieval",
    scope: {
      mode: "answer_key",
      page_limit: MODE_A_PAGE_LIMIT,
      forced: true
    },
    minutes: MODE_A_MINUTES,
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

function kstDayKey(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function todayKstKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 같은 agenda 를 그날(KST) 이미 실행했으면 건너뛴다 */
function alreadyRanToday(c: AgendaCandidate, runs: RunHist[]): boolean {
  const today = todayKstKey();
  return runs.some(
    (r) =>
      r.agenda === c.agenda &&
      kstDayKey(r.started_at) === today &&
      r.outcome != null
  );
}

function shouldDemote(c: AgendaCandidate, runs: RunHist[]): boolean {
  if (alreadyRanToday(c, runs)) return true;
  const key = demoteKey(c);
  const related = runs.filter(
    (r) => `${r.kind}::${c.gap_id}` === key || r.agenda === c.agenda
  );
  const failed = related.find((r) => r.outcome === "failed");
  if (failed) {
    const t = new Date(failed.started_at).getTime();
    if (Date.now() - t < 14 * 86400000) return true;
  }
  const recent = related
    .filter((r) => r.outcome === "no_change")
    .slice(0, 3);
  if (recent.length < 3) return false;
  const days = new Set(
    recent.map((r) => new Date(r.started_at).toISOString().slice(0, 10))
  );
  return days.size >= 3;
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
    out.push({
      id: `miss_followup:${kind}`,
      agenda: `검색 miss — ${label}`,
      why: `직전 모드 A 에서 ${label} ${count}건`,
      expected: "원인별 색인·청크·임베딩 보강 후보",
      kind: "inspect_gap",
      scope: { miss_cause: kind, count, from_run: recent.started_at },
      minutes: 15,
      verifiable: false,
      score: 200 + count * 5,
      gap_id: `miss_followup:${kind}`,
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
  demoted: string[];
}> {
  const budget = opts?.budgetMinutes ?? STUDY_BUDGET_MINUTES;
  const excluded = opts?.excludedIds ?? new Set<string>();
  const { gaps, candidates } = await buildAgendaCandidates(admin);
  const runs = await loadRecentRuns(admin);
  const demoted: string[] = [];

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
    if (shouldDemote(c, runs)) {
      demoted.push(c.id);
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
