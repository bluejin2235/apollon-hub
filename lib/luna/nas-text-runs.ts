/**
 * nas_text_runs — Work 본문 추출·임베딩 실행 기록.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeNasError } from "@/lib/luna/nas-error";

export type NasTextRunKind = "full" | "incremental";
export type NasTextRunStatus =
  | "running"
  | "done"
  | "failed"
  | "interrupted";

export type NasTextRunProgress = {
  targetCount?: number;
  ok: number;
  empty: number;
  failed: number;
  skipped: number;
  chunksCreated: number;
  embeddingsCreated: number;
  costUsd?: number;
  lastPath?: string | null;
};

export async function interruptStaleNasTextRuns(
  admin: SupabaseClient
): Promise<number> {
  const { data, error } = await admin
    .from("nas_text_runs")
    .update({
      status: "interrupted",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: "stale running → interrupted (next run resumes)"
    })
    .eq("status", "running")
    .select("id");
  if (error) {
    console.warn("[nas-text-runs] interrupt stale", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function startNasTextRun(
  admin: SupabaseClient,
  kind: NasTextRunKind,
  targetCount: number
): Promise<string> {
  // Another running record may be a live parallel extractor/embedding worker.
  // Starting this run is not evidence that another process was interrupted.
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("nas_text_runs")
    .insert({
      kind,
      status: "running",
      started_at: now,
      updated_at: now,
      target_count: targetCount
    })
    .select("id")
    .single();
  if (error) throw new Error(`NAS run start failed: ${describeNasError(error)}`);
  if (typeof data?.id !== "string" || !data.id) throw new Error("NAS run start returned no receipt");
  return data.id;
}

function progressRow(progress: NasTextRunProgress) {
  return {
    target_count: progress.targetCount,
    ok: progress.ok,
    empty: progress.empty,
    failed: progress.failed,
    skipped: progress.skipped,
    chunks_created: progress.chunksCreated,
    embeddings_created: progress.embeddingsCreated,
    cost_usd: progress.costUsd ?? 0,
    last_path: progress.lastPath ?? null,
    updated_at: new Date().toISOString()
  };
}

export async function updateNasTextRunProgress(
  admin: SupabaseClient,
  runId: string,
  progress: NasTextRunProgress
): Promise<void> {
  const row = progressRow(progress);
  if (progress.targetCount === undefined) {
    delete (row as { target_count?: number }).target_count;
  }
  const { data, error } = await admin
    .from("nas_text_runs")
    .update(row)
    .eq("id", runId)
    .eq("status", "running")
    .select("id")
    .single();
  if (error) throw new Error(`NAS run progress failed: ${describeNasError(error)}`);
  if (data?.id !== runId) throw new Error("NAS run progress receipt mismatch");
}

export async function finishNasTextRun(
  admin: SupabaseClient,
  runId: string,
  status: Exclude<NasTextRunStatus, "running">,
  progress: NasTextRunProgress,
  errorMsg?: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const row = {
    ...progressRow(progress),
    status,
    finished_at: now,
    error: errorMsg ?? null
  };
  if (progress.targetCount === undefined) {
    delete (row as { target_count?: number }).target_count;
  }
  const { data, error } = await admin
    .from("nas_text_runs")
    .update(row)
    .eq("id", runId)
    .eq("status", "running")
    .select("id")
    .single();
  if (error) throw new Error(`NAS run finish failed: ${describeNasError(error)}`);
  if (data?.id !== runId) throw new Error("NAS run finish receipt mismatch");
}

/** 아침 리포트 — 「어젯밤 본문 N건 추출 · 청크 N개」 */
export async function collectNasTextMorningLine(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("nas_text_runs")
    .select(
      "ok, empty, failed, skipped, chunks_created, embeddings_created, status, kind"
    )
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .in("status", ["done", "interrupted", "failed"]);
  if (error) {
    console.error("[nas-text-runs] morning", error);
    return null;
  }
  const rows = data ?? [];
  if (rows.length === 0) return null;

  let ok = 0;
  let chunks = 0;
  let embeds = 0;
  let anyDone = false;
  let anyInterrupted = false;
  let anyFailed = false;
  let failed = 0;
  for (const r of rows) {
    ok += Number(r.ok) || 0;
    chunks += Number(r.chunks_created) || 0;
    embeds += Number(r.embeddings_created) || 0;
    if (r.status === "done") anyDone = true;
    failed += Number(r.failed) || 0;
    if (r.status === "failed") anyFailed = true;
    if (r.status === "interrupted") anyInterrupted = true;
  }

  const bits: string[] = [];
  if (ok > 0 || chunks > 0) {
    bits.push(
      `어젯밤 본문 ${ok.toLocaleString("ko-KR")}건 추출 · 청크 ${chunks.toLocaleString("ko-KR")}개`
    );
  } else if (anyDone && !anyFailed && !anyInterrupted && failed === 0) {
    bits.push("어젯밤 본문 추출 — 신규 없음");
  } else if (anyFailed || anyInterrupted || failed > 0) {
    bits.push("어젯밤 본문 추출 — 완료되지 않은 작업 있음");
  }
  if (embeds > 0) {
    bits.push(`임베딩 ${embeds.toLocaleString("ko-KR")}개`);
  }
  if (bits.length === 0) return null;
  // A successful run must not hide a different run's failures or interruption.
  // Do not promise automatic recovery: scheduling and retry policy are separate.
  if (failed > 0) bits.push(`실패 ${failed.toLocaleString("ko-KR")}건`);
  if (anyFailed) bits.push("실패한 실행 있음");
  if (anyInterrupted) bits.push("중단된 실행 있음");
  return bits.join(" · ");
}
