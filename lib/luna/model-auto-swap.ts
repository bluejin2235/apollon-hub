import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LUNA_MODEL_COST_SETTINGS_DEFAULT,
  LUNA_MODEL_COST_SETTINGS_KEY,
  LUNA_TIER_ORDER,
  LUNA_USAGE_ALERTS_KEY,
  normalizeModelCostSettings,
  normalizeUsageAlerts,
  type LunaCostMode,
  type LunaModelCostSettings,
  type LunaTier
} from "@/lib/luna/brain-models";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";
import {
  fetchAndCacheMarketModels,
  loadLatestMarketSnapshot,
  type MarketModelRow
} from "@/lib/luna/model-market";
import {
  blendedUsd,
  buildSwapReason,
  estimateMonthlyKrwForPicks,
  findMarketRow,
  pickForTierMode,
  slugMatchesModel,
  validateModeCandidate,
  valuePerCost
} from "@/lib/luna/model-modes";

export {
  blendedUsd,
  buildSwapReason,
  findMarketRow,
  slugMatchesModel,
  valuePerCost
};

export function valuePerCostMetric(
  row: MarketModelRow,
  metric: "intel" | "multi" | "agent" = "intel"
): number {
  const score =
    metric === "multi"
      ? Number(row.multilingual_index) || 0
      : metric === "agent"
        ? Number(row.agentic_index) || 0
        : Number(row.intelligence_index) || 0;
  const cost = blendedUsd(row);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return score / (cost / 1000);
}

/** @deprecated use pickForTierMode — 호환용 래퍼 (balanced) */
export function pickForTier(
  tier: LunaTier,
  rows: MarketModelRow[],
  mode: LunaCostMode = "balanced"
): MarketModelRow | null {
  return pickForTierMode(tier, rows, mode);
}

export function validateSwap(
  tier: LunaTier,
  from: MarketModelRow | null,
  to: MarketModelRow,
  mode: LunaCostMode = "balanced"
): { ok: true; reasonNote?: string } | { ok: false; reason: string } {
  return validateModeCandidate(tier, to, { mode, from });
}

async function getSettings(
  admin: SupabaseClient
): Promise<LunaModelCostSettings> {
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", LUNA_MODEL_COST_SETTINGS_KEY)
    .maybeSingle();
  return data?.value
    ? normalizeModelCostSettings(data.value)
    : { ...LUNA_MODEL_COST_SETTINGS_DEFAULT };
}

async function saveSettings(
  admin: SupabaseClient,
  settings: LunaModelCostSettings
): Promise<void> {
  await admin.from("luna_settings").upsert(
    {
      key: LUNA_MODEL_COST_SETTINGS_KEY,
      value: settings,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
}

export async function runModelInspect(
  admin: SupabaseClient,
  opts?: { force?: boolean; usdKrw?: number }
): Promise<{
  ok: boolean;
  message: string;
  swapped: Array<{ tier: LunaTier; to: string; savings: number | null }>;
  proposals: Array<{ tier: LunaTier; to: string; reason: string }>;
  market_count: number;
  market_error: string | null;
}> {
  const settings = await getSettings(admin);
  const mode = settings.mode ?? "balanced";
  const market = await fetchAndCacheMarketModels(admin);
  if (!market.ok) {
    console.warn("[luna/model-inspect] fetch", market.message);
  }

  const { rows } = await loadLatestMarketSnapshot(admin);
  const usdKrw = opts?.usdKrw && opts.usdKrw > 0 ? opts.usdKrw : 1380;

  if (!market.ok && rows.length === 0) {
    const now = new Date();
    const next = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await saveSettings(admin, {
      ...settings,
      last_inspect_at: now.toISOString(),
      next_inspect_at: next.toISOString(),
      last_market_error: market.message
    });
    return {
      ok: false,
      message: market.message,
      swapped: [],
      proposals: [],
      market_count: 0,
      market_error: market.message
    };
  }

  const { data: tiers } = await admin
    .from("luna_engine_tiers")
    .select("tier, provider, model_id, model_label, use_caching, use_batch");

  const swapped: Array<{
    tier: LunaTier;
    to: string;
    savings: number | null;
  }> = [];
  const proposals: Array<{ tier: LunaTier; to: string; reason: string }> = [];

  const { data: alertRow } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", LUNA_USAGE_ALERTS_KEY)
    .maybeSingle();
  const monthlyLimit = normalizeUsageAlerts(alertRow?.value ?? null)
    .monthly_limit;

  const today = new Date();
  const from28 = new Date(today);
  from28.setDate(from28.getDate() - 27);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const { data: usage28 } = await admin
    .from("luna_usage_daily")
    .select("tier, input_tokens, output_tokens")
    .gte("date", isoDay(from28))
    .lte("date", isoDay(today));
  const usageTok = new Map<string, number>();
  for (const u of usage28 ?? []) {
    const t = String(u.tier).toUpperCase();
    const tok =
      (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
    usageTok.set(t, (usageTok.get(t) ?? 0) + tok);
  }
  const currentByTier = {} as Record<LunaTier, string>;
  for (const t of LUNA_TIER_ORDER) {
    currentByTier[t] =
      String((tiers ?? []).find((x) => x.tier === t)?.model_id ?? "") || "";
  }

  for (const tier of LUNA_TIER_ORDER) {
    if (tier === "S" && settings.protect_s) continue;
    const current = (tiers ?? []).find((t) => t.tier === tier);
    if (!current) continue;

    const fromRow = findMarketRow(rows, String(current.model_id));
    const candidate = pickForTierMode(tier, rows, mode);
    if (!candidate) {
      console.info(`[luna/model-inspect] ${tier}: 후보 없음 (${mode})`);
      continue;
    }
    if (slugMatchesModel(candidate.model_slug, String(current.model_id))) {
      continue;
    }

    const trialPicks = {} as Record<LunaTier, MarketModelRow | null>;
    for (const t of LUNA_TIER_ORDER) {
      trialPicks[t] = findMarketRow(rows, currentByTier[t]);
    }
    trialPicks[tier] = candidate;
    const monthlyTo = estimateMonthlyKrwForPicks(
      trialPicks,
      currentByTier,
      rows,
      usageTok,
      usdKrw,
      28
    );

    const check = validateModeCandidate(tier, candidate, {
      mode,
      from: fromRow,
      monthlyToKrw: monthlyTo,
      monthlyLimitKrw: monthlyLimit
    });
    if (!check.ok) {
      console.info(
        `[luna/model-inspect] ${tier}: 거부 → ${candidate.model_slug} (${check.reason})`
      );
      continue;
    }

    const reason = buildSwapReason(
      fromRow,
      candidate,
      check.reasonNote
    );
    proposals.push({ tier, to: candidate.model_slug, reason });

    if (!settings.auto_swap) {
      console.info(
        `[luna/model-inspect] ${tier}: 제안만 (${mode}) ${current.model_id} → ${candidate.model_slug}`
      );
      continue;
    }

    if (swapped.length >= 1) continue; // 적용은 한 번에 1등급

    const fromCost = fromRow ? blendedUsd(fromRow) : Number.POSITIVE_INFINITY;
    const toCost = blendedUsd(candidate);
    const savingsUsd =
      Number.isFinite(fromCost) && Number.isFinite(toCost)
        ? Math.max(0, fromCost - toCost) * 2
        : null;
    const savingsKrw =
      savingsUsd != null ? Math.round(savingsUsd * usdKrw) : null;

    const toProvider = (candidate.provider ?? "anthropic").toLowerCase();
    const toLabel = candidate.model_slug;

    console.info(
      `[luna/model-inspect] ${tier}: 교체 (${mode}) ${current.model_id} → ${candidate.model_slug} | ${reason}`
    );

    await admin
      .from("luna_engine_tiers")
      .update({
        provider: ["openai", "google", "anthropic"].includes(toProvider)
          ? toProvider
          : "anthropic",
        model_id: candidate.model_slug,
        model_label: toLabel,
        updated_at: new Date().toISOString()
      })
      .eq("tier", tier);

    await admin.from("luna_model_changes").insert({
      tier,
      from_provider: current.provider,
      from_model_id: current.model_id,
      from_model_label: current.model_label,
      to_provider: toProvider,
      to_model_id: candidate.model_slug,
      to_model_label: toLabel,
      reason: `${tier}등급 자동 점검(${mode}) · ${reason}`,
      savings_krw_month: savingsKrw,
      exam_result: "pending"
    });

    swapped.push({
      tier,
      to: candidate.model_slug,
      savings: savingsKrw
    });

    await lunaNotify(
      admin,
      "prompt_change",
      `${tier}등급을 ${candidate.model_slug} 로 바꿨어요${
        savingsKrw != null
          ? `. 월 ₩${savingsKrw.toLocaleString("ko-KR")} 절감 예상`
          : ""
      }`,
      reason,
      {
        level: "info",
        link: LUNA_LINKS.brainModel,
        meta: { tier, model: candidate.model_slug, savings_krw: savingsKrw }
      }
    );
  }

  const now = new Date();
  const next = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await saveSettings(admin, {
    ...settings,
    last_inspect_at: now.toISOString(),
    next_inspect_at: next.toISOString(),
    last_market_error: market.ok ? null : market.message
  });

  const marketError = market.ok ? null : market.message;
  let message: string;
  if (swapped.length > 0) {
    message = `${swapped[0]!.tier}등급 → ${swapped[0]!.to}`;
  } else if (!settings.auto_swap && proposals.length > 0) {
    message = `점검 완료 · 자동 교체 꺼짐 · 제안 ${proposals.length}건 (${mode})`;
  } else if (market.ok) {
    message = `점검 완료 · 교체 없음 · ${market.message}`;
  } else {
    message = `${market.message} (캐시 ${rows.length}건으로 점검)`;
  }

  return {
    ok: market.ok || rows.length > 0,
    message,
    swapped,
    proposals,
    market_count: rows.length || market.count,
    market_error: marketError
  };
}
