import type { SupabaseClient } from "@supabase/supabase-js";

export type MergeGateSettings = {
  merge_threshold: number;
  max_wait_days: number;
};

export type MergeGateDecision = {
  shouldRun: boolean;
  trigger: "threshold" | "timeout" | null;
  count: number;
  oldestDays: number;
  settings: MergeGateSettings;
};

const DEFAULT_THRESHOLD = 15;
const DEFAULT_MAX_WAIT = 7;

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export async function loadMergeGateSettings(
  admin: SupabaseClient
): Promise<MergeGateSettings> {
  const { data, error } = await admin
    .from("luna_learning_settings")
    .select("merge_threshold, max_wait_days")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[luna/knowledge-merge-gate] settings", error);
  }

  return {
    merge_threshold: clampInt(
      Number(data?.merge_threshold),
      3,
      100,
      DEFAULT_THRESHOLD
    ),
    max_wait_days: clampInt(
      Number(data?.max_wait_days),
      1,
      30,
      DEFAULT_MAX_WAIT
    )
  };
}

export async function evaluateMergeGate(
  admin: SupabaseClient
): Promise<MergeGateDecision> {
  const settings = await loadMergeGateSettings(admin);

  const { count: candidateCount, error: countError } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate")
    .neq("category", "identity");

  if (countError) {
    throw new Error(countError.message);
  }

  const count = candidateCount ?? 0;

  const { data: oldestRow, error: oldestError } = await admin
    .from("luna_learnings")
    .select("created_at")
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestError) {
    throw new Error(oldestError.message);
  }

  const oldestCreatedAt =
    oldestRow && typeof oldestRow.created_at === "string"
      ? oldestRow.created_at
      : null;
  const oldestDays = oldestCreatedAt ? daysSince(oldestCreatedAt) : 0;

  const byThreshold = count >= settings.merge_threshold;
  const byTimeout = count > 0 && oldestDays >= settings.max_wait_days;

  if (byThreshold) {
    return {
      shouldRun: true,
      trigger: "threshold",
      count,
      oldestDays,
      settings
    };
  }
  if (byTimeout) {
    return {
      shouldRun: true,
      trigger: "timeout",
      count,
      oldestDays,
      settings
    };
  }
  return {
    shouldRun: false,
    trigger: null,
    count,
    oldestDays,
    settings
  };
}

export async function recordMergeRun(
  admin: SupabaseClient,
  opts: {
    count: number;
    trigger: "threshold" | "timeout" | "manual";
  }
): Promise<void> {
  const settings = await loadMergeGateSettings(admin);
  const { error } = await admin.from("luna_learning_settings").upsert(
    {
      id: 1,
      merge_threshold: settings.merge_threshold,
      max_wait_days: settings.max_wait_days,
      last_merge_at: new Date().toISOString(),
      last_merge_count: opts.count,
      last_merge_trigger: opts.trigger
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("[luna/knowledge-merge-gate] record", error);
  }
}
