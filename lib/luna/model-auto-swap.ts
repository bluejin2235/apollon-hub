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
  loadLatestMarketSnapshot,
  type MarketModelRow
} from "@/lib/luna/model-market";

function valueScore(row: MarketModelRow, metric: "intel" | "multi" | "agent"): number {
  if (metric === "multi") return Number(row.multilingual_index) || 0;
  if (metric === "agent") return Number(row.agentic_index) || 0;
  return Number(row.intelligence_index) || 0;
}

function blendedUsd(row: MarketModelRow): number {
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
  return rows.filter((r) =>
    ["anthropic", "openai", "google"].includes(
      (r.provider ?? "").toLowerCase()
    )
  );
}

function pickForTier(
  tier: LunaTier,
  rows: MarketModelRow[]
): MarketModelRow | null {
  const pool = preferredOnly(rows);
  if (pool.length === 0) return null;

  if (tier === "S") {
    return [...pool].sort(
      (a, b) => valueScore(b, "intel") - valueScore(a, "intel")
    )[0] ?? null;
  }

  if (tier === "A") {
    const sorted = [...pool].sort(
      (a, b) => valueScore(b, "multi") - valueScore(a, "multi")
    );
    const cut = Math.max(1, Math.ceil(sorted.length * 0.3));
    const top = sorted.slice(0, cut);
    return (
      [...top].sort((a, b) => valuePerCost(b, "multi") - valuePerCost(a, "multi"))[0] ??
      null
    );
  }

  if (tier === "B") {
    const byPrice = [...pool].sort((a, b) => blendedUsd(a) - blendedUsd(b));
    const cut = Math.max(1, Math.ceil(byPrice.length * 0.3));
    const cheap = byPrice.slice(0, cut);
    return (
      [...cheap].sort(
        (a, b) => valueScore(b, "intel") - valueScore(a, "intel")
      )[0] ?? null
    );
  }

  // C: 가성비 1위, 종합 지능 ≥ 45
  const eligible = pool.filter((r) => valueScore(r, "intel") >= 45);
  const base = eligible.length > 0 ? eligible : pool;
  return (
    [...base].sort((a, b) => valuePerCost(b) - valuePerCost(a))[0] ?? null
  );
}

function slugMatchesModel(slug: string, modelId: string): boolean {
  const a = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a.includes(b) || b.includes(a) || a === b;
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
}> {
  const settings = await getSettings(admin);
  const market = await fetchAndCacheMarketModels(admin);
  if (!market.ok && market.count === 0) {
    // 캐시된 스냅샷으로라도 진행
    console.warn("[luna/model-inspect] fetch", market.message);
  }

  const { rows } = await loadLatestMarketSnapshot(admin);
  const usdKrw = opts?.usdKrw && opts.usdKrw > 0 ? opts.usdKrw : 1380;

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
      if (tier === "S" && settings.protect_s) continue;
      const current = (tiers ?? []).find((t) => t.tier === tier);
      if (!current) continue;
      const candidate = pickForTier(tier, rows);
      if (!candidate) continue;
      if (slugMatchesModel(candidate.model_slug, String(current.model_id))) {
        continue;
      }

      const fromCost = blendedUsd(
        rows.find((r) =>
          slugMatchesModel(r.model_slug, String(current.model_id))
        ) ?? candidate
      );
      const toCost = blendedUsd(candidate);
      const savingsUsd = Number.isFinite(fromCost)
        ? Math.max(0, fromCost - toCost) * 2
        : null;
      const savingsKrw =
        savingsUsd != null ? Math.round(savingsUsd * usdKrw) : null;

      const toProvider = (candidate.provider ?? "anthropic").toLowerCase();
      const toLabel =
        candidate.creator
          ? `${candidate.model_slug}`
          : candidate.model_slug;

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
        reason: `${tier}등급 자동 점검 교체`,
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
          savingsKrw != null ? `. 월 ₩${savingsKrw.toLocaleString("ko-KR")} 절감 예상` : ""
        }`,
        "두뇌 > 모델·비용에서 확인하세요.",
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
  // 다음 일요일 04:00 KST ≈ UTC 토 19:00 — 단순 +7일
  await saveSettings(admin, {
    ...settings,
    last_inspect_at: now.toISOString(),
    next_inspect_at: next.toISOString()
  });

  return {
    ok: true,
    message:
      swapped.length > 0
        ? `${swapped.length}개 등급 교체`
        : market.ok
          ? "점검 완료 · 교체 없음"
          : `점검 완료(시장: ${market.message}) · 교체 없음`,
    swapped,
    market_count: rows.length || market.count
  };
}
