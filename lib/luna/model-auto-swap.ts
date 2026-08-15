import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LUNA_MODEL_COST_SETTINGS_DEFAULT,
  LUNA_MODEL_COST_SETTINGS_KEY,
  LUNA_TIER_ORDER,
  normalizeModelCostSettings,
  type LunaModelCostSettings,
  type LunaTier
} from "@/lib/luna/brain-models";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";
import {
  fetchAndCacheMarketModels,
  isPreferredProvider,
  loadLatestMarketSnapshot,
  type MarketModelRow
} from "@/lib/luna/model-market";

function valueScore(
  row: MarketModelRow,
  metric: "intel" | "multi" | "agent"
): number {
  if (metric === "multi") return Number(row.multilingual_index) || 0;
  if (metric === "agent") return Number(row.agentic_index) || 0;
  return Number(row.intelligence_index) || 0;
}

export function blendedUsd(row: MarketModelRow): number {
  if (row.price_blended != null && Number.isFinite(Number(row.price_blended))) {
    return Number(row.price_blended);
  }
  const inn = Number(row.price_input) || 0;
  const out = Number(row.price_output) || 0;
  if (inn || out) return (inn * 3 + out) / 4;
  return Number.POSITIVE_INFINITY;
}

export function valuePerCost(
  row: MarketModelRow,
  metric: "intel" | "multi" | "agent" = "intel"
): number {
  const score = valueScore(row, metric);
  const cost = blendedUsd(row);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return score / (cost / 1000);
}

function preferredOnly(rows: MarketModelRow[]): MarketModelRow[] {
  return rows.filter((r) => isPreferredProvider(r.provider));
}

function ttftSec(row: MarketModelRow): number | null {
  const v = row.median_time_to_first_token_seconds;
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function isReasoning(row: MarketModelRow): boolean {
  return row.is_reasoning === true;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits);
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function buildSwapReason(
  from: MarketModelRow | null,
  to: MarketModelRow
): string {
  const fi = from?.intelligence_index ?? null;
  const ti = to.intelligence_index;
  const fb = from ? blendedUsd(from) : null;
  const tb = blendedUsd(to);
  const ft = from ? ttftSec(from) : null;
  const tt = ttftSec(to);
  return `지능 ${fmtNum(fi, 1)}→${fmtNum(ti, 1)}, 혼합가 ${
    fb != null && Number.isFinite(fb) ? fmtUsd(fb) : "—"
  }→${Number.isFinite(tb) ? fmtUsd(tb) : "—"}, TTFT ${
    ft != null ? `${fmtNum(ft, 2)}s` : "—"
  }→${tt != null ? `${fmtNum(tt, 2)}s` : "—"}`;
}

/**
 * S: 지능 최상위 (가격·지연 무시)
 * A: TTFT≤3 & 비추론 중 지능 1위
 * B: 가격 하위 20% & TTFT≤1 & 비추론 중 지능 1위
 * C: 지능≥40 중 혼합 단가 최저
 */
export function pickForTier(
  tier: LunaTier,
  rows: MarketModelRow[]
): MarketModelRow | null {
  const pool = preferredOnly(rows);
  if (pool.length === 0) return null;

  if (tier === "S") {
    return (
      [...pool].sort(
        (a, b) => valueScore(b, "intel") - valueScore(a, "intel")
      )[0] ?? null
    );
  }

  if (tier === "A") {
    const eligible = pool.filter((r) => {
      const t = ttftSec(r);
      return !isReasoning(r) && t != null && t <= 3;
    });
    return (
      [...eligible].sort(
        (a, b) => valueScore(b, "intel") - valueScore(a, "intel")
      )[0] ?? null
    );
  }

  if (tier === "B") {
    const withTtft = pool.filter((r) => {
      const t = ttftSec(r);
      return !isReasoning(r) && t != null && t <= 1;
    });
    if (withTtft.length === 0) return null;
    const byPrice = [...withTtft].sort(
      (a, b) => blendedUsd(a) - blendedUsd(b)
    );
    const cut = Math.max(1, Math.ceil(byPrice.length * 0.2));
    const cheap = byPrice.slice(0, cut);
    return (
      [...cheap].sort(
        (a, b) => valueScore(b, "intel") - valueScore(a, "intel")
      )[0] ?? null
    );
  }

  // C
  const eligible = pool.filter((r) => valueScore(r, "intel") >= 40);
  const base = eligible.length > 0 ? eligible : pool;
  return (
    [...base].sort((a, b) => blendedUsd(a) - blendedUsd(b))[0] ?? null
  );
}

/** 교체 전 검증 — 실패하면 교체하지 않음 */
export function validateSwap(
  tier: LunaTier,
  from: MarketModelRow | null,
  to: MarketModelRow
): { ok: true } | { ok: false; reason: string } {
  const toCost = blendedUsd(to);
  const fromCost = from ? blendedUsd(from) : null;

  // 어느 등급이든 가격이 현재보다 비싸면 금지
  if (
    fromCost != null &&
    Number.isFinite(fromCost) &&
    Number.isFinite(toCost) &&
    toCost > fromCost + 1e-9
  ) {
    return {
      ok: false,
      reason: `가격 상승 금지 (${fmtUsd(fromCost)} → ${fmtUsd(toCost)})`
    };
  }

  if (tier === "A") {
    if (isReasoning(to)) {
      return { ok: false, reason: "A등급은 비추론만" };
    }
    const t = ttftSec(to);
    if (t == null) return { ok: false, reason: "A등급 TTFT 데이터 없음" };
    if (t > 3) return { ok: false, reason: `A등급 TTFT>${t.toFixed(2)}s` };
  }

  if (tier === "B") {
    if (isReasoning(to)) {
      return { ok: false, reason: "B등급은 비추론만" };
    }
    const t = ttftSec(to);
    if (t == null) return { ok: false, reason: "B등급 TTFT 데이터 없음" };
    if (t > 1) return { ok: false, reason: `B등급 TTFT>${t.toFixed(2)}s` };
    if (
      fromCost != null &&
      Number.isFinite(fromCost) &&
      Number.isFinite(toCost) &&
      toCost > fromCost + 1e-9
    ) {
      return { ok: false, reason: "B등급 혼합가 ≤ 현재" };
    }
  }

  if (tier === "C") {
    if (
      fromCost != null &&
      Number.isFinite(fromCost) &&
      Number.isFinite(toCost) &&
      toCost > fromCost + 1e-9
    ) {
      return { ok: false, reason: "C등급 혼합가 ≤ 현재" };
    }
  }

  return { ok: true };
}

export function slugMatchesModel(slug: string, modelId: string): boolean {
  const a = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a.includes(b) || b.includes(a) || a === b;
}

export function findMarketRow(
  rows: MarketModelRow[],
  modelId: string
): MarketModelRow | null {
  return (
    rows.find((r) => slugMatchesModel(r.model_slug, modelId)) ?? null
  );
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
  market_count: number;
  market_error: string | null;
}> {
  const settings = await getSettings(admin);
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

  if (settings.auto_swap) {
    for (const tier of LUNA_TIER_ORDER) {
      if (swapped.length >= 1) break; // 한 번에 최대 1개 등급
      if (tier === "S" && settings.protect_s) continue;
      const current = (tiers ?? []).find((t) => t.tier === tier);
      if (!current) continue;

      const fromRow = findMarketRow(rows, String(current.model_id));
      const candidate = pickForTier(tier, rows);
      if (!candidate) {
        console.info(`[luna/model-inspect] ${tier}: 후보 없음`);
        continue;
      }
      if (slugMatchesModel(candidate.model_slug, String(current.model_id))) {
        console.info(`[luna/model-inspect] ${tier}: 유지 ${candidate.model_slug}`);
        continue;
      }

      const check = validateSwap(tier, fromRow, candidate);
      if (!check.ok) {
        console.info(
          `[luna/model-inspect] ${tier}: 교체 거부 → ${candidate.model_slug} (${check.reason})`
        );
        continue;
      }

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
      const reason = buildSwapReason(fromRow, candidate);

      console.info(
        `[luna/model-inspect] ${tier}: 교체 ${current.model_id} → ${candidate.model_slug} | ${reason}`
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
        reason: `${tier}등급 자동 점검 · ${reason}`,
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
  return {
    ok: market.ok || rows.length > 0,
    message:
      swapped.length > 0
        ? `${swapped[0]!.tier}등급 → ${swapped[0]!.to}`
        : market.ok
          ? `점검 완료 · 교체 없음 · ${market.message}`
          : `${market.message} (캐시 ${rows.length}건으로 점검)`,
    swapped,
    market_count: rows.length || market.count,
    market_error: marketError
  };
}
