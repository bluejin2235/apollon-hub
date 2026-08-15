import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  LUNA_FEATURE_LABEL,
  LUNA_MODEL_COST_SETTINGS_KEY,
  LUNA_MODEL_OPTIONS,
  LUNA_TIER_META,
  LUNA_TIER_ORDER,
  LUNA_USAGE_ALERTS_KEY,
  normalizeModelCostSettings,
  normalizeUsageAlerts,
  providerConnectedFlags,
  type LunaUsageAlerts
} from "@/lib/luna/brain-models";
import { runModelInspect, valuePerCost } from "@/lib/luna/model-auto-swap";
import {
  loadLatestMarketSnapshot,
  loadMarketHistory,
  type MarketModelRow
} from "@/lib/luna/model-market";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 120;

const USD_KRW_FALLBACK = 1380;

async function loadFx(admin: SupabaseClient): Promise<{
  usd_krw: number;
  date: string | null;
}> {
  const { data, error } = await admin
    .from("fx_daily_rates")
    .select("date, usd_krw")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || data?.usd_krw == null) {
    return { usd_krw: USD_KRW_FALLBACK, date: null };
  }
  return {
    usd_krw: Number(data.usd_krw),
    date: typeof data.date === "string" ? data.date : null
  };
}

function kstDate(offsetDays = 0): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().slice(0, 10);
}

function brandOf(provider: string | null | undefined): "Claude" | "GPT" | "Gemini" | "Other" {
  const p = (provider ?? "").toLowerCase();
  if (p.includes("anthropic") || p.includes("claude")) return "Claude";
  if (p.includes("openai") || p.includes("gpt")) return "GPT";
  if (p.includes("google") || p.includes("gemini")) return "Gemini";
  return "Other";
}

function matchTierToSlug(
  slug: string,
  tiers: Array<{ tier: string; model_id: string }>
): string[] {
  const s = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return tiers
    .filter((t) => {
      const m = String(t.model_id).toLowerCase().replace(/[^a-z0-9]/g, "");
      return s.includes(m) || m.includes(s);
    })
    .map((t) => t.tier);
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const range =
    request.nextUrl.searchParams.get("range") === "30"
      ? 30
      : request.nextUrl.searchParams.get("range") === "all"
        ? 3650
        : 7;

  const connected = providerConnectedFlags();
  const aaKey = Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim());

  const { data: tiers } = await admin
    .from("luna_engine_tiers")
    .select(
      "tier, provider, model_id, model_label, use_caching, use_batch, note, updated_at"
    )
    .order("tier", { ascending: true });

  const orderedTiers = LUNA_TIER_ORDER.map(
    (t) =>
      (tiers ?? []).find((r) => r.tier === t) ?? {
        tier: t,
        provider: "anthropic",
        model_id: "",
        model_label: "—",
        use_caching: false,
        use_batch: false,
        note: null,
        updated_at: null
      }
  );

  let usdKrw = USD_KRW_FALLBACK;
  let fxDate: string | null = null;
  try {
    const fx = await loadFx(admin);
    usdKrw = fx.usd_krw;
    fxDate = fx.date;
  } catch {
    /* keep default */
  }

  const { rows: marketRows, fetched_at: marketFetchedAt } =
    await loadLatestMarketSnapshot(admin);

  const today = kstDate();
  const from = kstDate(-(range - 1));
  const { data: usageRows } = await admin
    .from("luna_usage_daily")
    .select(
      "date, tier, model_id, feature, calls, input_tokens, output_tokens"
    )
    .gte("date", from)
    .lte("date", today);

  const hasFeature = (usageRows ?? []).some(
    (r) => typeof r.feature === "string" && r.feature.length > 0
  );

  // 비용 추정: 시장 blended USD * tokens/1e6 * usdKrw (없으면 토큰만)
  const priceByModel = new Map<string, number>();
  for (const m of marketRows) {
    const blended =
      m.price_blended ??
      ((Number(m.price_input) || 0) * 3 + (Number(m.price_output) || 0)) / 4;
    if (blended) priceByModel.set(m.model_slug.toLowerCase(), blended);
  }

  function estimateKrw(modelId: string, tokens: number): number {
    const key = modelId.toLowerCase();
    let usdPerM = priceByModel.get(key);
    if (usdPerM == null) {
      for (const [slug, p] of priceByModel) {
        if (slug.includes(key) || key.includes(slug)) {
          usdPerM = p;
          break;
        }
      }
    }
    if (usdPerM == null || !tokens) return 0;
    return Math.round((tokens / 1_000_000) * usdPerM * usdKrw);
  }

  const weekFrom = kstDate(-6);
  const prevFrom = kstDate(-13);
  let weekCost = 0;
  let prevWeekCost = 0;
  let weekCalls = 0;
  let weekTokens = 0;
  const byFeature = new Map<
    string,
    {
      tier: string;
      feature: string;
      model_id: string;
      calls: number;
      tokens: number;
      cost: number;
    }
  >();
  const byTierWeek = new Map<string, number>();

  for (const row of usageRows ?? []) {
    const date = String(row.date).slice(0, 10);
    const tokens =
      (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0);
    const calls = Number(row.calls) || 0;
    const cost = estimateKrw(String(row.model_id), tokens);
    const tier = String(row.tier || "").toUpperCase();

    if (date >= weekFrom) {
      weekCost += cost;
      weekCalls += calls;
      weekTokens += tokens;
      byTierWeek.set(tier, (byTierWeek.get(tier) ?? 0) + cost);
    } else if (date >= prevFrom && date < weekFrom) {
      prevWeekCost += cost;
    }

    if (date >= from) {
      const feature =
        typeof row.feature === "string" && row.feature
          ? row.feature
          : `_tier_${tier}`;
      const key = `${tier}::${feature}::${row.model_id}`;
      const cur = byFeature.get(key) ?? {
        tier,
        feature,
        model_id: String(row.model_id),
        calls: 0,
        tokens: 0,
        cost: 0
      };
      cur.calls += calls;
      cur.tokens += tokens;
      cur.cost += cost;
      byFeature.set(key, cur);
    }
  }

  const featureRows = Array.from(byFeature.values())
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .map((r) => ({
      ...r,
      feature_label:
        r.feature.startsWith("_tier_")
          ? `${r.tier}등급 합계`
          : LUNA_FEATURE_LABEL[
              r.feature as keyof typeof LUNA_FEATURE_LABEL
            ] ?? r.feature,
      share:
        weekCost > 0 || r.cost > 0
          ? Math.round(
              (r.cost /
                Math.max(
                  1,
                  Array.from(byFeature.values()).reduce((s, x) => s + x.cost, 0)
                )) *
                100
            )
          : 0
    }));

  const weekChangePct =
    prevWeekCost > 0
      ? Math.round(((weekCost - prevWeekCost) / prevWeekCost) * 100)
      : null;
  const monthEstimate = Math.round(weekCost * (30 / 7));

  const { data: changes } = await admin
    .from("luna_model_changes")
    .select(
      "id, tier, from_provider, from_model_id, from_model_label, to_provider, to_model_id, to_model_label, reason, savings_krw_month, exam_result, exam_note, reverted, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const changeMap = new Map<string, string>();
  for (const c of changes ?? []) {
    const key = String(c.tier);
    if (!changeMap.has(key)) {
      const d = new Date(c.created_at as string);
      const label = `${d.getMonth() + 1}/${d.getDate()} 교체`;
      changeMap.set(key, c.reverted ? "되돌림" : label);
    }
  }

  const ourSlugs = orderedTiers
    .map((t) => String(t.model_id))
    .filter(Boolean);
  const history = await loadMarketHistory(admin, ourSlugs, 12);

  // 순위
  const ranked = preferredRank(marketRows).map((r, i) => {
    const ours = matchTierToSlug(r.model_slug, orderedTiers);
    return {
      rank: i + 1,
      ...r,
      brand: brandOf(r.provider),
      cost_krw:
        r.price_blended != null
          ? Math.round(Number(r.price_blended) * usdKrw)
          : null,
      value: Math.round(valuePerCost(r) * 10) / 10,
      our_tiers: ours,
      delta: null as number | null
    };
  });

  const { data: settingsRow } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", LUNA_MODEL_COST_SETTINGS_KEY)
    .maybeSingle();
  const settings = settingsRow?.value
    ? normalizeModelCostSettings(settingsRow.value)
    : normalizeModelCostSettings(null);

  const { data: alertRow } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", LUNA_USAGE_ALERTS_KEY)
    .maybeSingle();
  const alerts: LunaUsageAlerts = alertRow?.value
    ? normalizeUsageAlerts(alertRow.value)
    : normalizeUsageAlerts(null);

  // A등급 가격 추이 해석
  let priceNote: string | null = null;
  const aTier = orderedTiers.find((t) => t.tier === "A");
  if (aTier?.model_id) {
    const series = history.filter((h) =>
      h.model_slug
        .toLowerCase()
        .includes(String(aTier.model_id).toLowerCase().slice(0, 8))
    );
    if (series.length >= 2) {
      const first = series[0]!;
      const last = series[series.length - 1]!;
      const f =
        Number(first.price_blended) ||
        ((Number(first.price_input) || 0) * 3 +
          (Number(first.price_output) || 0)) /
          4;
      const l =
        Number(last.price_blended) ||
        ((Number(last.price_input) || 0) * 3 +
          (Number(last.price_output) || 0)) /
          4;
      if (f > 0 && l > 0) {
        const pct = Math.round(((f - l) / f) * 100);
        if (pct > 0) {
          const save = Math.round(weekCost * (pct / 100) * (30 / 7));
          priceNote = `3개월 새 A등급 단가가 ${pct}% 내렸습니다. 같은 사용량이면 월 ₩${save.toLocaleString("ko-KR")} 절감`;
        }
      }
    }
  }

  return NextResponse.json({
    connections: { ...connected, artificial_analysis: aaKey },
    fx: { usd_krw: usdKrw, date: fxDate },
    tiers: orderedTiers.map((t) => ({
      ...t,
      meta: LUNA_TIER_META.find((m) => m.tier === t.tier) ?? null,
      week_cost: byTierWeek.get(String(t.tier).toUpperCase()) ?? 0,
      change_badge: changeMap.get(String(t.tier)) ?? "유지",
      selectable: LUNA_MODEL_OPTIONS.filter((o) => {
        if (o.provider === "anthropic") return connected.anthropic;
        if (o.provider === "openai") return connected.openai;
        if (o.provider === "google") return connected.google;
        return false;
      })
    })),
    market: {
      fetched_at: marketFetchedAt,
      missing_key: !aaKey && marketRows.length === 0,
      rows: marketRows.map((r) => ({
        ...r,
        brand: brandOf(r.provider),
        cost_krw:
          r.price_blended != null
            ? Math.round(Number(r.price_blended) * usdKrw)
            : null,
        our_tiers: matchTierToSlug(r.model_slug, orderedTiers)
      }))
    },
    ranking: ranked,
    history: history.map((h) => ({
      ...h,
      brand: brandOf(h.provider),
      cost_krw:
        h.price_blended != null
          ? Math.round(Number(h.price_blended) * usdKrw)
          : null
    })),
    price_note: priceNote,
    usage: {
      range,
      has_feature: hasFeature,
      week_cost: weekCost,
      week_change_pct: weekChangePct,
      week_calls: weekCalls,
      week_tokens: weekTokens,
      month_estimate: monthEstimate,
      by_feature: featureRows
    },
    changes: changes ?? [],
    settings,
    alerts,
    model_options: LUNA_MODEL_OPTIONS
  });
}

function preferredRank(rows: MarketModelRow[]): MarketModelRow[] {
  return [...rows]
    .filter((r) =>
      ["anthropic", "openai", "google"].includes(
        (r.provider ?? "").toLowerCase()
      )
    )
    .sort((a, b) => valuePerCost(b) - valuePerCost(a));
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.settings) {
    const settings = normalizeModelCostSettings(body.settings);
    await admin.from("luna_settings").upsert(
      {
        key: LUNA_MODEL_COST_SETTINGS_KEY,
        value: settings,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
  }
  if (body.alerts) {
    const alerts = normalizeUsageAlerts(body.alerts);
    await admin.from("luna_settings").upsert(
      {
        key: LUNA_USAGE_ALERTS_KEY,
        value: alerts,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    body = {};
  }

  if (body.action === "inspect") {
    let usdKrw = USD_KRW_FALLBACK;
    try {
      const fx = await loadFx(admin);
      usdKrw = fx.usd_krw;
    } catch {
      /* default */
    }
    const result = await runModelInspect(admin, { force: true, usdKrw });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
