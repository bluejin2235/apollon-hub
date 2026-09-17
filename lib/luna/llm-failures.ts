/**
 * LLM 호출 실패 집계 — 조용한 실패를 아침 점검에 보이게.
 * luna_settings.key = llm_failures_daily
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LunaTier } from "@/lib/luna/engine";
import { kstIsoDate } from "@/lib/fx/dates";

export const LLM_FAILURE_YELLOW = 5;
export const LLM_FAILURE_RED = 15;

export type LlmFailureRecord = {
  date: string;
  count: number;
  by_feature: Record<string, number>;
  last_error: string | null;
  last_tier: string | null;
  last_provider: string | null;
  last_model_id: string | null;
  last_feature: string | null;
  last_at: string | null;
};

const SETTINGS_KEY = "llm_failures_daily";

function emptyDay(date: string): LlmFailureRecord {
  return {
    date,
    count: 0,
    by_feature: {},
    last_error: null,
    last_tier: null,
    last_provider: null,
    last_model_id: null,
    last_feature: null,
    last_at: null
  };
}

export async function recordLlmFailure(
  admin: SupabaseClient,
  opts: {
    feature: string;
    tier?: LunaTier | string | null;
    provider?: string | null;
    model_id?: string | null;
    error: unknown;
    context?: string;
  }
): Promise<void> {
  const errMsg =
    opts.error instanceof Error
      ? opts.error.message.slice(0, 400)
      : String(opts.error).slice(0, 400);
  const tier = opts.tier ? String(opts.tier) : "?";
  const provider = opts.provider?.trim() || "?";
  const model = opts.model_id?.trim() || "?";
  const ctx = opts.context ? ` · ${opts.context}` : "";

  console.error(
    `[luna/llm-fail] tier=${tier} provider=${provider} model=${model} feature=${opts.feature}${ctx}`,
    errMsg
  );

  try {
    const today = kstIsoDate();
    const { data } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();

    const prev =
      data?.value && typeof data.value === "object"
        ? (data.value as Partial<LlmFailureRecord>)
        : null;
    const base =
      prev && prev.date === today
        ? {
            ...emptyDay(today),
            ...prev,
            by_feature: {
              ...(prev.by_feature && typeof prev.by_feature === "object"
                ? prev.by_feature
                : {})
            }
          }
        : emptyDay(today);

    const next: LlmFailureRecord = {
      ...base,
      count: (base.count || 0) + 1,
      by_feature: {
        ...base.by_feature,
        [opts.feature]: (base.by_feature[opts.feature] ?? 0) + 1
      },
      last_error: errMsg,
      last_tier: tier,
      last_provider: provider,
      last_model_id: model,
      last_feature: opts.feature,
      last_at: new Date().toISOString()
    };

    const { error } = await admin.from("luna_settings").upsert(
      {
        key: SETTINGS_KEY,
        value: next,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
    if (error) {
      console.warn("[luna/llm-fail] persist", error.message);
    }
  } catch (persistErr) {
    console.warn("[luna/llm-fail] persist threw", persistErr);
  }
}

export async function getLlmFailureToday(
  admin: SupabaseClient
): Promise<LlmFailureRecord | null> {
  const today = kstIsoDate();
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/llm-fail] read", error);
    return null;
  }
  const v = data?.value;
  if (!v || typeof v !== "object") return emptyDay(today);
  const rec = v as Partial<LlmFailureRecord>;
  if (rec.date !== today) return emptyDay(today);
  return {
    ...emptyDay(today),
    ...rec,
    by_feature:
      rec.by_feature && typeof rec.by_feature === "object"
        ? (rec.by_feature as Record<string, number>)
        : {}
  };
}

export async function resolveLlmFailureCheck(
  admin: SupabaseClient
): Promise<{
  lastOkAt: string | null;
  extraDetail?: string;
  light: "green" | "yellow" | "red";
}> {
  const rec = await getLlmFailureToday(admin);
  const count = rec?.count ?? 0;
  const lastAt = rec?.last_at ?? null;
  if (count === 0) {
    return {
      lastOkAt: new Date().toISOString(),
      light: "green",
      extraDetail: "오늘 실패 0건"
    };
  }
  const topFeatures = Object.entries(rec?.by_feature ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k}×${n}`)
    .join(", ");
  const last =
    rec?.last_tier && rec?.last_provider
      ? `마지막 ${rec.last_tier}/${rec.last_provider}/${rec.last_feature ?? "?"} · ${rec.last_error ?? ""}`
      : rec?.last_error ?? "";
  const detail = `오늘 ${count}건${topFeatures ? ` (${topFeatures})` : ""}${last ? ` · ${last}` : ""}`;
  const light =
    count >= LLM_FAILURE_RED
      ? ("red" as const)
      : count >= LLM_FAILURE_YELLOW
        ? ("yellow" as const)
        : ("green" as const);
  return {
    lastOkAt: lastAt,
    light,
    extraDetail: detail
  };
}
