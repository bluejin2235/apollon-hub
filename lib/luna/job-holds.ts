/**
 * 사람이 일부러 끈 정기 작업 — 고장(노란·빨간불)과 갈라서 회색 「멈춰 둠」으로 본다.
 * Vercel 은 PC 의 STOP 파일을 못 읽으므로 luna_settings.luna_job_holds 가 표시다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const JOB_HOLDS_KEY = "luna_job_holds";
export const IMAGE_INDEX_CHECK_ID = "image_index";
export const IMAGE_INDEX_STOP_FILE = "media-index.STOP";
export const IMAGE_INDEX_HOLD_REASON = "검색 고칠 때까지";

export type JobHold = {
  by: "human";
  reason: string;
  since: string;
  source?: string;
};

export type JobHolds = Record<string, JobHold>;

export function parseJobHolds(value: unknown): JobHolds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: JobHolds = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    const since = typeof row.since === "string" ? row.since : "";
    if (!reason && !since) continue;
    out[id] = {
      by: "human",
      reason: reason || "사람이 멈춤",
      since,
      source: typeof row.source === "string" ? row.source : undefined
    };
  }
  return out;
}

export function imageIndexHold(now = new Date()): JobHold {
  return {
    by: "human",
    reason: IMAGE_INDEX_HOLD_REASON,
    since: now.toISOString(),
    source: IMAGE_INDEX_STOP_FILE
  };
}

export function formatHeldDetail(
  hold: JobHold,
  lastLabel: string,
  extra?: string
): string {
  const bits = ["멈춰 둠 (사람이 멈춤)"];
  if (hold.reason) bits.push(hold.reason);
  bits.push(`마지막 ${lastLabel}`);
  if (extra) bits.push(extra);
  return bits.join(" · ");
}

export async function loadJobHolds(admin: SupabaseClient): Promise<JobHolds> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", JOB_HOLDS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/job-holds] load", error.message);
    return {};
  }
  return parseJobHolds(data?.value);
}

export async function markJobHeld(
  admin: SupabaseClient,
  checkId: string,
  hold: JobHold
): Promise<void> {
  const current = await loadJobHolds(admin);
  const next: JobHolds = { ...current, [checkId]: hold };
  const iso = new Date().toISOString();
  const { error } = await admin.from("luna_settings").upsert(
    { key: JOB_HOLDS_KEY, value: next, updated_at: iso },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/job-holds] mark", checkId, error.message);
}

export async function clearJobHold(
  admin: SupabaseClient,
  checkId: string
): Promise<void> {
  const current = await loadJobHolds(admin);
  if (!(checkId in current)) return;
  const next = { ...current };
  delete next[checkId];
  const iso = new Date().toISOString();
  const { error } = await admin.from("luna_settings").upsert(
    { key: JOB_HOLDS_KEY, value: next, updated_at: iso },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/job-holds] clear", checkId, error.message);
}

/** PC 에 STOP 파일이 있으면 Vercel 이 볼 수 있게 hold 를 찍는다. 없으면 지우지 않는다. */
export async function syncImageIndexHoldFromStopFile(
  admin: SupabaseClient
): Promise<void> {
  try {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const flag = join(process.cwd(), IMAGE_INDEX_STOP_FILE);
    if (!existsSync(flag)) return;
    const current = await loadJobHolds(admin);
    if (current[IMAGE_INDEX_CHECK_ID]?.source === IMAGE_INDEX_STOP_FILE) return;
    await markJobHeld(admin, IMAGE_INDEX_CHECK_ID, imageIndexHold());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[luna/job-holds] STOP sync", message);
  }
}
