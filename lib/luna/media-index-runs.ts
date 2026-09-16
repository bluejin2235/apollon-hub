/**
 * luna_media_index_runs — 이미지 색인 시작·진행·종료 기록.
 * 스크립트(회사 PC)와 아침 리포트·luna_checks 가 함께 쓴다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaIndexRunStatus =
  | "running"
  | "done"
  | "failed"
  | "interrupted";

export type MediaIndexRunProgress = {
  indexed: number;
  skipped: number;
  failed: number;
  visionIn: number;
  visionOut: number;
  costUsd: number;
  lastPath?: string | null;
  failReasons?: Record<string, number>;
};

/** 이전 실행이 죽으면 running → interrupted */
export async function interruptStaleMediaRuns(
  admin: SupabaseClient
): Promise<number> {
  const { data, error } = await admin
    .from("luna_media_index_runs")
    .update({
      status: "interrupted",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: "stale running → interrupted (next run resumes via mtime skip)"
    })
    .eq("status", "running")
    .select("id");
  if (error) {
    console.warn("[media-index-runs] interrupt stale", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function startMediaIndexRun(
  admin: SupabaseClient,
  row: {
    root: string;
    model: string;
    limitN: number | null;
    candidateTotal: number;
    workTotal: number;
  }
): Promise<string | null> {
  await interruptStaleMediaRuns(admin);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("luna_media_index_runs")
    .insert({
      status: "running",
      started_at: now,
      updated_at: now,
      root: row.root,
      model: row.model,
      limit_n: row.limitN,
      candidate_total: row.candidateTotal,
      work_total: row.workTotal
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[media-index-runs] start", error.message);
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

export async function updateMediaIndexRunProgress(
  admin: SupabaseClient,
  runId: string,
  progress: MediaIndexRunProgress
): Promise<void> {
  const { error } = await admin
    .from("luna_media_index_runs")
    .update({
      indexed: progress.indexed,
      skipped: progress.skipped,
      failed: progress.failed,
      vision_in: progress.visionIn,
      vision_out: progress.visionOut,
      cost_usd: progress.costUsd,
      last_path: progress.lastPath ?? null,
      fail_reasons: progress.failReasons ?? {},
      updated_at: new Date().toISOString()
    })
    .eq("id", runId);
  if (error) console.warn("[media-index-runs] progress", error.message);
}

export async function finishMediaIndexRun(
  admin: SupabaseClient,
  runId: string,
  status: Exclude<MediaIndexRunStatus, "running">,
  progress: MediaIndexRunProgress,
  errorMsg?: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("luna_media_index_runs")
    .update({
      status,
      finished_at: now,
      updated_at: now,
      indexed: progress.indexed,
      skipped: progress.skipped,
      failed: progress.failed,
      vision_in: progress.visionIn,
      vision_out: progress.visionOut,
      cost_usd: progress.costUsd,
      last_path: progress.lastPath ?? null,
      fail_reasons: progress.failReasons ?? {},
      error: errorMsg ?? null
    })
    .eq("id", runId);
  if (error) console.warn("[media-index-runs] finish", error.message);
}

/** 아침 리포트 — 창 안 실행 합산 */
export async function collectMediaIndexMorningLine(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("luna_media_index_runs")
    .select("indexed, cost_usd, status, finished_at, started_at")
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .in("status", ["done", "interrupted", "failed"]);
  if (error) {
    console.error("[media-index-runs] morning", error);
    return null;
  }
  const rows = data ?? [];
  if (rows.length === 0) return null;

  let indexed = 0;
  let cost = 0;
  let anyDone = false;
  let anyInterrupted = false;
  for (const r of rows) {
    indexed += Number(r.indexed) || 0;
    cost += Number(r.cost_usd) || 0;
    if (r.status === "done") anyDone = true;
    if (r.status === "interrupted" || r.status === "failed") {
      anyInterrupted = true;
    }
  }

  const costLabel =
    cost > 0 ? ` · $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}` : "";
  if (indexed > 0) {
    const suffix = anyInterrupted && !anyDone ? " (중단·이어받기)" : "";
    return `어젯밤 이미지 ${indexed.toLocaleString("ko-KR")}장 색인${costLabel}${suffix}`;
  }
  if (anyDone) {
    return `어젯밤 이미지 색인 — 신규 없음 (전부 skip)${costLabel}`;
  }
  if (anyInterrupted) {
    return `어젯밤 이미지 색인 중단됨 — 다음 실행에서 이어받음`;
  }
  return null;
}
