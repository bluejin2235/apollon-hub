/**
 * 선정된 아젠다를 돌리고 luna_study_runs 에 남긴다.
 * 하루 LLM 비용 상한 $1.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgendaCandidate, SelectedAgenda } from "@/lib/luna/study-agenda";
import { STUDY_DAILY_COST_USD } from "@/lib/luna/study-agenda";

export type StudyRunRow = {
  id: string;
  agenda: string;
  why: string;
  expected: string;
  kind: string;
  scope: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  result: Record<string, unknown>;
  outcome: "improved" | "no_change" | "failed" | null;
  cost_usd: number;
  llm_calls: number;
};

export type StudyRunResult = {
  run: StudyRunRow;
  stopped_for_cost?: boolean;
};

async function todayCostUsd(admin: SupabaseClient): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data } = await admin
    .from("luna_study_runs")
    .select("cost_usd")
    .gte("started_at", start.toISOString());
  return (data ?? []).reduce(
    (s, r) => s + (typeof r.cost_usd === "number" ? r.cost_usd : 0),
    0
  );
}

async function insertRun(
  admin: SupabaseClient,
  row: Omit<StudyRunRow, "id" | "finished_at" | "result" | "outcome" | "cost_usd" | "llm_calls"> & {
    cost_usd?: number;
    llm_calls?: number;
    result?: Record<string, unknown>;
    outcome?: StudyRunRow["outcome"];
    finished_at?: string | null;
  }
): Promise<StudyRunRow> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .insert({
      agenda: row.agenda,
      why: row.why,
      expected: row.expected,
      kind: row.kind,
      scope: row.scope,
      started_at: row.started_at,
      finished_at: row.finished_at ?? null,
      result: row.result ?? {},
      outcome: row.outcome ?? null,
      cost_usd: row.cost_usd ?? 0,
      llm_calls: row.llm_calls ?? 0
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StudyRunRow;
}

async function finishRun(
  admin: SupabaseClient,
  id: string,
  patch: Partial<StudyRunRow>
): Promise<StudyRunRow> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .update({
      finished_at: patch.finished_at ?? new Date().toISOString(),
      result: patch.result ?? {},
      outcome: patch.outcome ?? null,
      cost_usd: patch.cost_usd ?? 0,
      llm_calls: patch.llm_calls ?? 0
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StudyRunRow;
}

/** 정답 문서 id 기반 검색 시험 (모드 A) / 실패 질문 사람 확인 (모드 B) */
async function runProbeRetrieval(
  admin: SupabaseClient,
  scope: Record<string, unknown>,
  limit: number
): Promise<{
  result: Record<string, unknown>;
  outcome: StudyRunRow["outcome"];
  cost_usd: number;
  llm_calls: number;
}> {
  const { runProbeRetrievalExam } = await import("@/lib/luna/probe-retrieval");
  const out = await runProbeRetrievalExam(admin, scope, limit);
  return {
    result: { ...out.result, scope_note: scope },
    outcome: out.outcome,
    cost_usd: out.cost_usd,
    llm_calls: out.llm_calls
  };
}

async function runInspectGap(
  admin: SupabaseClient,
  candidate: AgendaCandidate
): Promise<{
  result: Record<string, unknown>;
  outcome: StudyRunRow["outcome"];
  cost_usd: number;
  llm_calls: number;
}> {
  void admin;
  return {
    result: {
      inspected: true,
      why: candidate.why,
      scope: candidate.scope,
      learned: "수치 점검만 수행 — 자동 수정은 검증 가능한 아젠다에서",
      next: "검증 가능한 항목이 예산에 들어오면 그쪽을 우선"
    },
    outcome: "no_change",
    cost_usd: 0,
    llm_calls: 0
  };
}

async function runRefreshStale(
  admin: SupabaseClient,
  limit: number
): Promise<{
  result: Record<string, unknown>;
  outcome: StudyRunRow["outcome"];
  cost_usd: number;
  llm_calls: number;
}> {
  const {
    countIndexQueue,
    enqueueNotionRefresh,
    loadLastQueueStudyResult
  } = await import("@/lib/luna/index-queue");
  const lastDrain = await loadLastQueueStudyResult(admin);
  const queued = await enqueueNotionRefresh({
    admin,
    queuedBy: "selfstudy"
  });
  const counts = await countIndexQueue(admin);
  const sample = queued.sample.slice(0, limit);
  const lastLine =
    lastDrain && typeof lastDrain.result_line === "string"
      ? lastDrain.result_line
      : null;
  return {
    result: {
      did: `properties 공백 ${queued.inserted}건을 대기열에 넣었습니다`,
      result_line: lastLine
        ? `${lastLine} · 대기열 pending ${counts.pending}`
        : `대기열에 ${queued.inserted}건 추가 · pending ${counts.pending} · 이미 있음 ${queued.skipped}`,
      listed: queued.inserted,
      queued: queued.inserted,
      skipped_already: queued.skipped,
      stale_found: 0,
      null_props_found: queued.nullPropsFound,
      pending: counts.pending,
      running: counts.running,
      last_drain: lastDrain,
      sample,
      learned:
        "properties null 페이지만 대기열에 넣습니다. 14일 stale 은 넣지 않습니다",
      next:
        counts.pending > 0
          ? "다음 색인 실행이 대기열부터 최대 200건 처리합니다"
          : "대기열이 비었습니다",
      note: "한 실행 상한 200건 — 한꺼번에 돌리지 않음"
    },
    // Queue preparation does not measure an improvement in retrieval quality.
    outcome: "no_change",
    cost_usd: 0,
    llm_calls: 0
  };
}

async function runMaterializeSecondary(
  admin: SupabaseClient,
  scope: Record<string, unknown>
): Promise<{
  result: Record<string, unknown>;
  outcome: StudyRunRow["outcome"];
  cost_usd: number;
  llm_calls: number;
}> {
  const years = Array.isArray(scope.thin_years)
    ? (scope.thin_years as string[])
    : [];
  const { count: sameNeed } = await admin
    .from("luna_links")
    .select("id", { count: "exact", head: true })
    .eq("kind", "same")
    .neq("source", "human")
    .neq("status", "rejected");
  return {
    result: {
      thin_years: years,
      same_need: sameNeed ?? 0,
      learned: "2차 데이터가 얇은 범위를 확인했습니다",
      next: "자습 › 2차 데이터 만들기 또는 build-links 범위 실행",
      note: "대량 build-links 는 별도 상한 작업 — 여기선 진단만"
    },
    // Identifying missing relations is diagnostic, not a before/after improvement.
    outcome: "no_change",
    cost_usd: 0,
    llm_calls: 0
  };
}

export async function executeStudyAgenda(
  admin: SupabaseClient,
  candidate: AgendaCandidate,
  opts?: { limit?: number; trigger?: "cron" | "manual" }
): Promise<StudyRunResult> {
  const trigger = opts?.trigger ?? "manual";
  const spent = await todayCostUsd(admin);
  const scope = { ...candidate.scope, trigger };
  if (spent >= STUDY_DAILY_COST_USD) {
    const run = await insertRun(admin, {
      agenda: candidate.agenda,
      why: candidate.why,
      expected: candidate.expected,
      kind: candidate.kind,
      scope,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      result: {
        stopped: true,
        trigger,
        reason: `하루 비용 상한 $${STUDY_DAILY_COST_USD} 도달 (이미 $${spent.toFixed(4)})`
      },
      outcome: "failed",
      cost_usd: 0,
      llm_calls: 0
    });
    return { run, stopped_for_cost: true };
  }

  const started = new Date().toISOString();
  const draft = await insertRun(admin, {
    agenda: candidate.agenda,
    why: candidate.why,
    expected: candidate.expected,
    kind: candidate.kind,
    scope,
    started_at: started
  });

  const limit = opts?.limit ?? 40;
  try {
    let out: Awaited<ReturnType<typeof runProbeRetrieval>>;
    if (candidate.kind === "probe_retrieval") {
      out = await runProbeRetrieval(admin, candidate.scope, limit);
    } else if (candidate.kind === "refresh_stale") {
      out = await runRefreshStale(admin, limit);
    } else if (candidate.kind === "materialize_secondary") {
      out = await runMaterializeSecondary(admin, candidate.scope);
    } else {
      out = await runInspectGap(admin, candidate);
    }

    if (spent + out.cost_usd > STUDY_DAILY_COST_USD) {
      out = {
        ...out,
        result: {
          ...out.result,
          cost_capped: true,
          note: `비용 상한 $${STUDY_DAILY_COST_USD}`
        }
      };
    }

    const run = await finishRun(admin, draft.id, {
      result: { ...out.result, trigger },
      outcome: out.outcome,
      cost_usd: out.cost_usd,
      llm_calls: out.llm_calls
    });
    return { run, stopped_for_cost: Boolean((out.result as { cost_capped?: boolean }).cost_capped) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const run = await finishRun(admin, draft.id, {
      result: { error: message, trigger },
      outcome: "failed",
      cost_usd: 0,
      llm_calls: 0
    });
    return { run };
  }
}

export async function runSelectedTonight(
  admin: SupabaseClient,
  items: SelectedAgenda[],
  opts?: { limitPerItem?: number; trigger?: "cron" | "manual" }
): Promise<{ runs: StudyRunRow[]; stopped_for_cost: boolean }> {
  const runs: StudyRunRow[] = [];
  let stopped = false;
  for (const item of items) {
    if (item.excluded || item.when !== "tonight") continue;
    if (!item.verifiable) continue;
    const res = await executeStudyAgenda(admin, item, {
      limit: opts?.limitPerItem ?? 40,
      trigger: opts?.trigger ?? "manual"
    });
    runs.push(res.run);
    if (res.stopped_for_cost) {
      stopped = true;
      break;
    }
  }
  return { runs, stopped_for_cost: stopped };
}

export async function listStudyRuns(
  admin: SupabaseClient,
  limit = 50
): Promise<StudyRunRow[]> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[luna/study-run] list", error);
    return [];
  }
  return (data ?? []) as StudyRunRow[];
}

/** 블루진 반응 → 신호 */
export async function recordStudyFeedback(
  admin: SupabaseClient,
  opts: {
    runId: string;
    userId: string;
    verdict: "good" | "why" | "bad";
    note?: string;
  }
): Promise<void> {
  const { insertLunaSignal } = await import("@/lib/luna/signals");
  const kind =
    opts.verdict === "good" ? "positive" : opts.verdict === "bad" ? "negative" : "correction";
  await insertLunaSignal(admin, {
    kind,
    source: "question_answer",
    subject_type: "question",
    subject_id: opts.runId,
    reason: opts.verdict,
    note: opts.note,
    user_id: opts.userId,
    context: { channel: "study_feedback", study_run_id: opts.runId }
  });
}
