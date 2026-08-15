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
import {
  applyCostMode,
  buildModePreview,
  ensureActiveModePeriod,
  estimateModeMonthlyCosts,
  explainTierSelections,
  loadModeHistory
} from "@/lib/luna/model-modes";
import { fetchProviderModelCatalog } from "@/lib/luna/model-api-ids";
import {
  brandCounts,
  buildCuratedDisplaySet,
  defaultHistoryVisibleSlugs
} from "@/lib/luna/model-display-set";
import { estimateKrwFromTokens } from "@/lib/luna/model-pricing";
import type { LunaCostMode } from "@/lib/luna/brain-models";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 120;

const USD_KRW_FALLBACK = 1380;

async function loadFx(admin: SupabaseClient): Promise<{
  usd_krw: number;
  date: string | null;
}> {
  // 전날 우선, 없으면 가장 최근 usd_krw
  const yesterday = kstDate(-1);
  const { data: yRow } = await admin
    .from("fx_daily_rates")
    .select("date, usd_krw")
    .eq("date", yesterday)
    .maybeSingle();
  if (yRow?.usd_krw != null && Number.isFinite(Number(yRow.usd_krw))) {
    return {
      usd_krw: Number(yRow.usd_krw),
      date: typeof yRow.date === "string" ? yRow.date : yesterday
    };
  }

  const { data, error } = await admin
    .from("fx_daily_rates")
    .select("date, usd_krw")
    .not("usd_krw", "is", null)
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
  const aaKey = Boolean(
    process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY?.trim()
  );

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

  // 비용 추정: 시장 blended USD 우선, 없으면 공급사 공식 단가
  const priceByModel = new Map<string, number>();
  for (const m of marketRows) {
    const blended =
      m.price_blended ??
      ((Number(m.price_input) || 0) * 3 + (Number(m.price_output) || 0)) / 4;
    if (blended) priceByModel.set(m.model_slug.toLowerCase(), blended);
  }

  function marketUsdPerM(modelId: string): number | null {
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
    return usdPerM ?? null;
  }

  let usedOfficialPricing = false;
  function estimateKrw(modelId: string, tokens: number): number {
    const { krw, usedOfficial } = estimateKrwFromTokens(
      modelId,
      tokens,
      usdKrw,
      marketUsdPerM(modelId)
    );
    if (usedOfficial && krw > 0) usedOfficialPricing = true;
    return krw;
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

  // 산점도·순위·추이 공통 15개 (이후 지능 하한선 필터)
  const curated = buildCuratedDisplaySet(marketRows, ourSlugs, 15);

  function enrich(r: MarketModelRow, rank: number) {
    const ours = matchTierToSlug(r.model_slug, orderedTiers);
    const blended =
      r.price_blended ??
      ((Number(r.price_input) || 0) * 3 + (Number(r.price_output) || 0)) / 4;
    return {
      rank,
      ...r,
      brand: brandOf(r.provider),
      cost_krw:
        Number.isFinite(blended) && blended > 0
          ? Math.round(blended * usdKrw)
          : null,
      value: Math.round(valuePerCost(r) * 10) / 10,
      our_tiers: ours,
      delta: null as number | null
    };
  }

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

  const minIntel = settings.rank_min_intelligence;
  const displayRows = curated.filter((r) => {
    const ours = matchTierToSlug(r.model_slug, orderedTiers);
    if (ours.length > 0) return true;
    return (Number(r.intelligence_index) || 0) >= minIntel;
  });

  const ranked = displayRows
    .map((r, i) => enrich(r, i + 1))
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const counts = brandCounts(displayRows);
  const historyDefaultOn = defaultHistoryVisibleSlugs(displayRows);
  // 추이는 필터된 표시 집합 기준
  const historySlugs = displayRows.map((r) => r.model_slug);
  const history = await loadMarketHistory(admin, historySlugs, 12);

  const selectable = preferredRank(marketRows).map((r) => {
    const blended =
      r.price_blended ??
      ((Number(r.price_input) || 0) * 3 + (Number(r.price_output) || 0)) / 4;
    const provider = (r.provider ?? "other").toLowerCase();
    const keyOk =
      provider === "anthropic"
        ? connected.anthropic
        : provider === "openai"
          ? connected.openai
          : provider === "google"
            ? connected.google
            : false;
    return {
      model_slug: r.model_slug,
      provider,
      brand: brandOf(r.provider),
      intelligence_index: r.intelligence_index,
      multilingual_index: r.multilingual_index,
      agentic_index: r.agentic_index,
      price_blended: Number.isFinite(blended) ? blended : null,
      cost_krw:
        Number.isFinite(blended) && blended > 0
          ? Math.round(blended * usdKrw)
          : null,
      median_time_to_first_token_seconds:
        r.median_time_to_first_token_seconds,
      median_output_tokens_per_second: r.median_output_tokens_per_second,
      is_reasoning: r.is_reasoning,
      disabled: !keyOk,
      disabled_reason: keyOk ? null : "API 키 미등록"
    };
  });

  console.info(
    "[luna/model-cost] curated display",
    displayRows.map((r) => `${r.provider}:${r.model_slug}`).join(", "),
    counts,
    `minIntel=${minIntel}`
  );

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

  const uniqueWeeks = new Set(
    history.map((h) => String(h.fetched_at).slice(0, 10))
  ).size;

  const usage28from = kstDate(-27);
  const { data: usage28 } = await admin
    .from("luna_usage_daily")
    .select("tier, input_tokens, output_tokens")
    .gte("date", usage28from)
    .lte("date", today);

  let modeEstimates: Record<LunaCostMode, number> = {
    cheap: 0,
    balanced: 0,
    performance: 0
  };
  let modeHistory: Awaited<ReturnType<typeof loadModeHistory>> = [];
  try {
    modeEstimates = await estimateModeMonthlyCosts(
      marketRows,
      orderedTiers.map((t) => ({
        tier: String(t.tier),
        model_id: String(t.model_id)
      })),
      (usage28 ?? []).map((u) => ({
        tier: String(u.tier),
        input_tokens: Number(u.input_tokens) || 0,
        output_tokens: Number(u.output_tokens) || 0
      })),
      usdKrw
    );
    await ensureActiveModePeriod(
      admin,
      settings.mode,
      modeEstimates[settings.mode] ?? null
    );
    modeHistory = await loadModeHistory(admin);
  } catch (err) {
    console.warn("[luna/model-cost] modes", err);
  }

  let catalog = null;
  try {
    catalog = await fetchProviderModelCatalog();
  } catch (err) {
    console.warn("[luna/model-cost] api catalog", err);
  }

  return NextResponse.json({
    connections: { ...connected, artificial_analysis: aaKey },
    fx: { usd_krw: usdKrw, date: fxDate },
    mode: settings.mode,
    mode_estimates: modeEstimates,
    mode_history: modeHistory,
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
      total_count: marketRows.length,
      display_count: displayRows.length,
      brand_counts: counts,
      history_default_on: historyDefaultOn,
      display_slugs: historySlugs,
      rank_min_intelligence: minIntel,
      index_note:
        "다국어 지수는 Artificial Analysis 유료 티어에서만 제공됩니다. 에이전트 지수는 무료 응답의 artificial_analysis_agentic_index 를 쓰며, 미측정이면 — 입니다. A등급 자동 선정은 종합 지능·TTFT만 사용합니다.",
      error:
        marketRows.length > 0
          ? null
          : settings.last_market_error ??
            (!aaKey
              ? "Artificial Analysis 조회 실패 — LUNA_ARTIFICIAL_ANALYSIS_API_KEY 없음"
              : "Artificial Analysis 조회 결과가 없습니다. [지금 점검]으로 다시 받아 보세요."),
      rows: ranked.map((r) => ({
        model_slug: r.model_slug,
        provider: r.provider,
        brand: r.brand,
        intelligence_index: r.intelligence_index,
        multilingual_index: r.multilingual_index,
        agentic_index: r.agentic_index,
        cost_krw: r.cost_krw,
        price_blended: r.price_blended,
        median_time_to_first_token_seconds:
          r.median_time_to_first_token_seconds,
        median_output_tokens_per_second: r.median_output_tokens_per_second,
        is_reasoning: r.is_reasoning,
        our_tiers: r.our_tiers,
        value: r.value
      }))
    },
    selectable,
    ranking: ranked,
    history: history.map((h) => ({
      ...h,
      brand: brandOf(h.provider),
      cost_krw:
        h.price_blended != null
          ? Math.round(Number(h.price_blended) * usdKrw)
          : h.price_input != null || h.price_output != null
            ? Math.round(
                (((Number(h.price_input) || 0) * 3 +
                  (Number(h.price_output) || 0)) /
                  4) *
                  usdKrw
              )
            : null,
      our_tiers: matchTierToSlug(h.model_slug, orderedTiers)
    })),
    history_weeks: uniqueWeeks,
    price_note: priceNote,
    usage: {
      range,
      has_feature: hasFeature,
      week_cost: weekCost,
      week_change_pct: weekChangePct,
      week_calls: weekCalls,
      week_tokens: weekTokens,
      month_estimate: monthEstimate,
      by_feature: featureRows,
      pricing_source: usedOfficialPricing ? "official" : "market"
    },
    changes: changes ?? [],
    settings,
    alerts,
    tier_explanations: explainTierSelections(
      marketRows,
      orderedTiers.map((t) => ({
        tier: String(t.tier),
        model_id: String(t.model_id)
      })),
      {
        mode: settings.mode,
        auto_swap: settings.auto_swap,
        protect_s: settings.protect_s,
        monthlyLimitKrw: alerts.monthly_limit,
        catalog
      }
    ),
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

  if (body.tier_update && typeof body.tier_update === "object") {
    const tu = body.tier_update as Record<string, unknown>;
    const tier = String(tu.tier ?? "").toUpperCase();
    const modelId = String(tu.model_id ?? "").trim();
    const providerRaw = String(tu.provider ?? "").toLowerCase();
    if (!["S", "A", "B", "C"].includes(tier) || !modelId) {
      return NextResponse.json(
        { error: "tier_update 형식 오류" },
        { status: 400 }
      );
    }
    const provider = ["anthropic", "openai", "google"].includes(providerRaw)
      ? providerRaw
      : "anthropic";

    const { data: current } = await admin
      .from("luna_engine_tiers")
      .select("tier, provider, model_id, model_label")
      .eq("tier", tier)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: "등급 없음" }, { status: 404 });
    }
    if (String(current.model_id) === modelId) {
      return NextResponse.json({ ok: true, message: "변경 없음" });
    }

    await admin
      .from("luna_engine_tiers")
      .update({
        provider,
        model_id: modelId,
        model_label: modelId,
        updated_at: new Date().toISOString()
      })
      .eq("tier", tier);

    await admin.from("luna_model_changes").insert({
      tier,
      from_provider: current.provider,
      from_model_id: current.model_id,
      from_model_label: current.model_label,
      to_provider: provider,
      to_model_id: modelId,
      to_model_label: modelId,
      reason: "사람이 직접 변경",
      savings_krw_month: null,
      exam_result: "pending"
    });

    return NextResponse.json({
      ok: true,
      message: `${tier}등급을 ${modelId}로 바꿨어요. 회귀 시험으로 확인해 보세요`
    });
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

  let body: {
    action?: string;
    mode?: string;
  } = {};
  try {
    body = (await request.json()) as { action?: string; mode?: string };
  } catch {
    body = {};
  }

  const parseMode = (raw: unknown): LunaCostMode | null => {
    if (raw === "cheap" || raw === "balanced" || raw === "performance") {
      return raw;
    }
    return null;
  };

  if (body.action === "preview_mode" || body.action === "apply_mode") {
    const mode = parseMode(body.mode);
    if (!mode) {
      return NextResponse.json({ error: "invalid mode" }, { status: 400 });
    }
    let usdKrw = USD_KRW_FALLBACK;
    try {
      const fx = await loadFx(admin);
      usdKrw = fx.usd_krw;
    } catch {
      /* default */
    }
    const { rows: marketRows } = await loadLatestMarketSnapshot(admin);
    const from28 = kstDate(-27);
    const today = kstDate();
    const { data: usage28 } = await admin
      .from("luna_usage_daily")
      .select("tier, input_tokens, output_tokens")
      .gte("date", from28)
      .lte("date", today);
    const usage = (usage28 ?? []).map((u) => ({
      tier: String(u.tier),
      input_tokens: Number(u.input_tokens) || 0,
      output_tokens: Number(u.output_tokens) || 0
    }));

    const { data: alertRow } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", LUNA_USAGE_ALERTS_KEY)
      .maybeSingle();
    const monthlyLimit = normalizeUsageAlerts(alertRow?.value ?? null)
      .monthly_limit;

    const catalog = await fetchProviderModelCatalog();

    if (body.action === "preview_mode") {
      const { data: tiers } = await admin
        .from("luna_engine_tiers")
        .select("tier, model_id");
      const preview = buildModePreview(
        mode,
        marketRows,
        (tiers ?? []).map((t) => ({
          tier: String(t.tier),
          model_id: String(t.model_id)
        })),
        usage,
        usdKrw,
        28,
        monthlyLimit,
        catalog
      );
      return NextResponse.json({ ok: true, preview });
    }

    const result = await applyCostMode(
      admin,
      mode,
      marketRows,
      usdKrw,
      usage,
      monthlyLimit,
      catalog
    );

    const { data: settingsRow } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", LUNA_MODEL_COST_SETTINGS_KEY)
      .maybeSingle();
    const settings = normalizeModelCostSettings(settingsRow?.value ?? null);
    await admin.from("luna_settings").upsert(
      {
        key: LUNA_MODEL_COST_SETTINGS_KEY,
        value: { ...settings, mode },
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );

    return NextResponse.json(result);
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
    if (!result.ok) {
      return NextResponse.json(
        {
          ...result,
          error: result.market_error ?? result.message
        },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
