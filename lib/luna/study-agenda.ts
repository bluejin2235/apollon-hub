/**
 * Gap → 할 일 후보 → 하루 예산 안에서 고르기.
 * 정답이 있는(검증 가능한) 것을 우선한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyGap, StudyMethod } from "@/lib/luna/study-health-meta";
import { scanStudyGaps } from "@/lib/luna/study-scan";

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
};

export type SelectedAgenda = AgendaCandidate & {
  excluded: boolean;
  when: "tonight" | "tomorrow";
};

export const STUDY_BUDGET_MINUTES = 60;
export const STUDY_DAILY_COST_USD = 1;

function minutesFor(gap: StudyGap): number {
  if (gap.method === "probe_retrieval") return Math.min(25, 8 + Math.ceil(gap.count / 20));
  if (gap.method === "materialize_secondary") return 40;
  if (gap.method === "refresh_stale") return 30;
  return Math.min(20, 5 + Math.ceil(gap.count / 50));
}

function agendaFromGap(gap: StudyGap): AgendaCandidate {
  const agenda =
    gap.method === "probe_retrieval"
      ? `${gap.table} 기준으로 검색이 자기 자료를 찾는지 시험`
      : gap.method === "materialize_secondary"
        ? `2차 데이터가 얇은 범위를 다시 묶기`
        : gap.method === "refresh_stale"
          ? `1차 색인 공백(properties·관계)을 대기열에 넣기`
          : `${gap.table} 부족함을 수치로 정리`;

  const expected =
    gap.method === "probe_retrieval"
      ? "정답 문서가 상위 k에 오는지 채점(모드 A) · 실패 질문은 사람 확인(모드 B)"
      : gap.method === "materialize_secondary"
        ? "연결 건수·애매 건수가 늘어나는지 확인"
        : gap.method === "refresh_stale"
          ? "properties null·관계 변경 페이지가 대기열에 들어가는지 확인"
          : "부족함 규모와 다음 액션이 문장으로 남음";

  let score = gap.impact;
  if (gap.human_failure) score += 1000;
  if (gap.verifiable) score += 400;

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
    human_failure: gap.human_failure
  };
}

type RunHist = {
  kind: string;
  agenda: string;
  outcome: string | null;
  started_at: string;
  finished_at: string | null;
};

async function loadRecentRuns(admin: SupabaseClient): Promise<RunHist[]> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("kind, agenda, outcome, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(120);
  if (error || !data) return [];
  return data as RunHist[];
}

function demoteKey(c: AgendaCandidate): string {
  return `${c.kind}::${c.gap_id}`;
}

function kstDayKey(iso: string, now = new Date()): string {
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
  // 실패 후 2주 쉬기
  const failed = related.find((r) => r.outcome === "failed");
  if (failed) {
    const t = new Date(failed.started_at).getTime();
    if (Date.now() - t < 14 * 86400000) return true;
  }
  // 3일 연속 no_change
  const recent = related
    .filter((r) => r.outcome === "no_change")
    .slice(0, 3);
  if (recent.length < 3) return false;
  const days = new Set(
    recent.map((r) => new Date(r.started_at).toISOString().slice(0, 10))
  );
  return days.size >= 3;
}

export async function buildAgendaCandidates(
  admin: SupabaseClient
): Promise<{ gaps: StudyGap[]; candidates: AgendaCandidate[] }> {
  const { gaps } = await scanStudyGaps(admin);
  const candidates = gaps.map(agendaFromGap);
  return { gaps, candidates };
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

  const ranked = [...candidates].sort((a, b) => {
    if (a.verifiable !== b.verifiable) return a.verifiable ? -1 : 1;
    return b.score - a.score;
  });

  const selected: SelectedAgenda[] = [];
  let used = 0;
  for (const c of ranked) {
    if (excluded.has(c.id)) {
      selected.push({ ...c, excluded: true, when: "tonight" });
      continue;
    }
    if (shouldDemote(c, runs)) {
      demoted.push(c.id);
      continue;
    }
    // 정답 없는 것은 자동 실행 후보에서 제외 (보고용 tomorrow)
    if (!c.verifiable) {
      selected.push({ ...c, excluded: false, when: "tomorrow" });
      continue;
    }
    if (used + c.minutes > budget) continue;
    selected.push({ ...c, excluded: false, when: "tonight" });
    used += c.minutes;
  }

  return { gaps, candidates, selected, demoted };
}
