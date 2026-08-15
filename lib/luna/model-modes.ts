import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LUNA_COST_MODE_META,
  LUNA_TIER_MIN_INTELLIGENCE_DEFAULT,
  LUNA_TIER_ORDER,
  type LunaCostMode,
  type LunaTier,
  type LunaTierMinIntelligence
} from "@/lib/luna/brain-models";
import {
  isPreferredProvider,
  type MarketModelRow
} from "@/lib/luna/model-market";
import {
  isSlugCallable,
  resolveApiModelId,
  type ProviderModelCatalog
} from "@/lib/luna/model-api-ids";

function intel(row: MarketModelRow): number {
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

export function valuePerCost(row: MarketModelRow): number {
  const score = intel(row);
  const cost = blendedUsd(row);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return score / (cost / 1000);
}

function ttftSec(row: MarketModelRow): number | null {
  const v = row.median_time_to_first_token_seconds;
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function isReasoning(row: MarketModelRow): boolean {
  return row.is_reasoning === true;
}

function preferredOnly(
  rows: MarketModelRow[],
  catalog?: ProviderModelCatalog | null
): MarketModelRow[] {
  return rows.filter(
    (r) =>
      isPreferredProvider(r.provider) &&
      isSlugCallable(r.provider, r.model_slug, catalog)
  );
}

function minPrice(rows: MarketModelRow[]): MarketModelRow | null {
  if (rows.length === 0) return null;
  return (
    [...rows].sort(
      (a, b) => blendedUsd(a) - blendedUsd(b) || intel(b) - intel(a)
    )[0] ?? null
  );
}

function maxIntel(rows: MarketModelRow[]): MarketModelRow | null {
  if (rows.length === 0) return null;
  return (
    [...rows].sort(
      (a, b) => intel(b) - intel(a) || blendedUsd(a) - blendedUsd(b)
    )[0] ?? null
  );
}

function topNByIntel(rows: MarketModelRow[], n: number): MarketModelRow[] {
  return [...rows].sort((a, b) => intel(b) - intel(a)).slice(0, n);
}

/** 지능 상위 percentile% (최소 1개) */
export function topPercentileByIntel(
  rows: MarketModelRow[],
  percentile: number
): MarketModelRow[] {
  if (rows.length === 0) return [];
  const pct = Math.min(100, Math.max(1, percentile));
  const sorted = [...rows].sort((a, b) => intel(b) - intel(a));
  const n = Math.max(1, Math.ceil((sorted.length * pct) / 100));
  return sorted.slice(0, n);
}

function resolveMins(
  mins?: LunaTierMinIntelligence | null
): LunaTierMinIntelligence {
  return mins ?? LUNA_TIER_MIN_INTELLIGENCE_DEFAULT;
}

/** A: 비추론 + TTFT ≤ 3 (지능 하한은 백분위로 별도) */
function poolA(
  rows: MarketModelRow[],
  catalog?: ProviderModelCatalog | null
): MarketModelRow[] {
  return preferredOnly(rows, catalog).filter((r) => {
    const t = ttftSec(r);
    return !isReasoning(r) && t != null && t <= 3;
  });
}

/** B: 비추론 + TTFT ≤ 1 + 지능 ≥ mins.B */
function poolB(
  rows: MarketModelRow[],
  catalog?: ProviderModelCatalog | null,
  minIntel = LUNA_TIER_MIN_INTELLIGENCE_DEFAULT.B
): MarketModelRow[] {
  return preferredOnly(rows, catalog).filter((r) => {
    const t = ttftSec(r);
    return !isReasoning(r) && t != null && t <= 1 && intel(r) >= minIntel;
  });
}

export function slugMatchesModel(slug: string, modelId: string): boolean {
  const a = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (a.includes(b) || b.includes(a) || a === b) return true;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t && !/^\d{8,}$/.test(t))
      .sort()
      .join("");
  return norm(slug) === norm(modelId) && norm(slug).length > 0;
}

export function findMarketRow(
  rows: MarketModelRow[],
  modelId: string
): MarketModelRow | null {
  if (!modelId) return null;
  return rows.find((r) => slugMatchesModel(r.model_slug, modelId)) ?? null;
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
  to: MarketModelRow,
  modeNote?: string
): string {
  const fi = from?.intelligence_index ?? null;
  const ti = to.intelligence_index;
  const fb = from ? blendedUsd(from) : null;
  const tb = blendedUsd(to);
  const ft = from ? ttftSec(from) : null;
  const tt = ttftSec(to);

  const intelPct =
    fi != null && Number(fi) > 0 && ti != null
      ? Math.round(((Number(ti) - Number(fi)) / Number(fi)) * 100)
      : null;
  const pricePct =
    fb != null && Number.isFinite(fb) && fb > 0 && Number.isFinite(tb)
      ? Math.round(((tb - fb) / fb) * 100)
      : null;

  const intelPart = `지능 ${fmtNum(fi, 1)}→${fmtNum(ti, 1)}${
    intelPct != null ? `(${intelPct >= 0 ? "+" : ""}${intelPct}%)` : ""
  }`;
  const pricePart = `가격 ${
    fb != null && Number.isFinite(fb) ? fmtUsd(fb) : "—"
  }→${Number.isFinite(tb) ? fmtUsd(tb) : "—"}${
    pricePct != null ? `(${pricePct >= 0 ? "+" : ""}${pricePct}%)` : ""
  }`;
  const ttftPart = `TTFT ${
    ft != null ? `${fmtNum(ft, 2)}s` : "—"
  }→${tt != null ? `${fmtNum(tt, 2)}s` : "—"}`;

  const base = `${intelPart}, ${pricePart}, ${ttftPart}`;
  return modeNote ? `${base} — ${modeNote}` : base;
}

/**
 * 모드별 등급 선정. 후보 없으면 null → 현재 모델 유지.
 * catalog 가 있으면 실제 API 호출 불가 slug 는 제외.
 * 순수 가성비(지능÷가격)는 쓰지 않음 — 등급별 품질 하한 후 가격/지능.
 */
export function pickForTierMode(
  tier: LunaTier,
  rows: MarketModelRow[],
  mode: LunaCostMode,
  catalog?: ProviderModelCatalog | null,
  mins?: LunaTierMinIntelligence | null
): MarketModelRow | null {
  const m = resolveMins(mins);
  const pool = preferredOnly(rows, catalog);
  if (pool.length === 0) return null;

  if (tier === "S") {
    if (mode === "cheap") {
      return minPrice(pool.filter((r) => intel(r) >= 50));
    }
    // 가성비·성능: 지능 절대 1위
    return maxIntel(pool);
  }

  if (tier === "A") {
    const a = poolA(rows, catalog);
    if (a.length === 0) return null;
    if (mode === "cheap") return minPrice(a);
    if (mode === "balanced") {
      return minPrice(topPercentileByIntel(a, m.A_percentile));
    }
    return maxIntel(a);
  }

  if (tier === "B") {
    const aPick = pickForTierMode("A", rows, mode, catalog, mins);
    let b = poolB(rows, catalog, m.B);
    if (aPick) {
      b = b.filter(
        (r) => !slugMatchesModel(r.model_slug, aPick.model_slug)
      );
    }
    if (b.length === 0) return null;
    if (mode === "performance") return maxIntel(b);
    return minPrice(b);
  }

  // C
  if (mode === "cheap") {
    return minPrice(pool.filter((r) => intel(r) >= 20));
  }
  if (mode === "balanced") {
    return minPrice(pool.filter((r) => intel(r) >= m.C));
  }
  return minPrice(topNByIntel(pool.filter((r) => intel(r) >= 20), 5));
}

/** 교체 적용 시 DB 에 넣을 실제 API model id */
export function apiModelIdForRow(
  row: MarketModelRow,
  catalog?: ProviderModelCatalog | null
): string {
  return (
    resolveApiModelId(row.provider, row.model_slug, catalog) ?? row.model_slug
  );
}

/**
 * 모드별 가격 상승 허용.
 * cheap: 상승 금지 / balanced: 지능+30%면 가격 2배 / performance: 가격 4배
 */
export function validatePriceRise(
  mode: LunaCostMode,
  from: MarketModelRow | null,
  to: MarketModelRow
): { ok: true; note: string } | { ok: false; reason: string } {
  const fromP = from ? blendedUsd(from) : null;
  const toP = blendedUsd(to);
  const fromI = from ? intel(from) : null;
  const toI = intel(to);
  const modeLabel = LUNA_COST_MODE_META[mode].label;

  if (fromP == null || !Number.isFinite(fromP) || fromP <= 0) {
    return {
      ok: true,
      note: `${modeLabel} 모드 허용 범위 내 (현재 단가 없음)`
    };
  }
  if (!Number.isFinite(toP) || toP <= 0) {
    return { ok: false, reason: "후보 단가 없음" };
  }

  const priceRatio = toP / fromP;
  const intelGain =
    fromI != null && fromI > 0 ? (toI - fromI) / fromI : 0;

  if (mode === "cheap") {
    if (toP > fromP + 1e-9) {
      return { ok: false, reason: "가격 우선: 가격 상승 금지" };
    }
    return { ok: true, note: `${modeLabel} 모드 허용 범위 내` };
  }

  if (mode === "balanced") {
    const maxRatio = intelGain >= 0.3 ? 2 : 1;
    if (priceRatio > maxRatio + 1e-9) {
      return {
        ok: false,
        reason:
          intelGain >= 0.3
            ? `가성비: 가격 ${(priceRatio * 100).toFixed(0)}% > 허용 200%`
            : `가성비: 지능 상승 ${(intelGain * 100).toFixed(0)}% < 30% 이라 가격 상승 불가`
      };
    }
    return { ok: true, note: `${modeLabel} 모드 허용 범위 내` };
  }

  if (priceRatio > 4 + 1e-9) {
    return {
      ok: false,
      reason: `성능 우선: 가격 ${(priceRatio * 100).toFixed(0)}% > 허용 400%`
    };
  }
  return { ok: true, note: `${modeLabel} 모드 허용 범위 내` };
}

/** A/B 하한선 + 모드별 가격 + (선택) 월 한도. A는 TTFT·비추론만(백분위는 선정 시). */
export function validateModeCandidate(
  tier: LunaTier,
  to: MarketModelRow,
  opts?: {
    mode?: LunaCostMode;
    from?: MarketModelRow | null;
    monthlyToKrw?: number | null;
    monthlyLimitKrw?: number | null;
    mins?: LunaTierMinIntelligence | null;
  }
): { ok: true; reasonNote?: string } | { ok: false; reason: string } {
  const m = resolveMins(opts?.mins);
  if (tier === "A") {
    if (isReasoning(to)) return { ok: false, reason: "A등급은 비추론만" };
    const t = ttftSec(to);
    if (t == null) return { ok: false, reason: "A등급 TTFT 데이터 없음" };
    if (t > 3) return { ok: false, reason: `A등급 TTFT ${t.toFixed(2)}s > 3` };
  }
  if (tier === "B") {
    if (isReasoning(to)) return { ok: false, reason: "B등급은 비추론만" };
    const t = ttftSec(to);
    if (t == null) return { ok: false, reason: "B등급 TTFT 데이터 없음" };
    if (t > 1) return { ok: false, reason: `B등급 TTFT ${t.toFixed(2)}s > 1` };
    if (intel(to) < m.B) {
      return { ok: false, reason: `B등급 지능 < ${m.B}` };
    }
  }
  if (tier === "C") {
    const floor = opts?.mode === "cheap" ? 20 : m.C;
    if (opts?.mode === "performance") {
      /* 성능: 상위 5 선정 — 절대 하한 20 */
      if (intel(to) < 20) return { ok: false, reason: "C등급 지능 < 20" };
    } else if (intel(to) < floor) {
      return { ok: false, reason: `C등급 지능 < ${floor}` };
    }
  }

  let reasonNote: string | undefined;
  if (opts?.mode) {
    const price = validatePriceRise(opts.mode, opts.from ?? null, to);
    if (!price.ok) return price;
    reasonNote = price.note;
  }

  if (
    opts?.monthlyLimitKrw != null &&
    opts.monthlyLimitKrw > 0 &&
    opts.monthlyToKrw != null &&
    opts.monthlyToKrw > opts.monthlyLimitKrw
  ) {
    return {
      ok: false,
      reason: `월 예상 ₩${opts.monthlyToKrw.toLocaleString("ko-KR")} > 한도 ₩${opts.monthlyLimitKrw.toLocaleString("ko-KR")}`
    };
  }

  return { ok: true, reasonNote };
}

export type ModePickPreviewLine = {
  tier: LunaTier;
  from_model_id: string;
  to_model_id: string | null;
  changed: boolean;
  reason: string;
  from_intel: number | null;
  to_intel: number | null;
  from_blended: number | null;
  to_blended: number | null;
  from_ttft: number | null;
  to_ttft: number | null;
};

export type ModePickPreview = {
  mode: LunaCostMode;
  mode_label: string;
  lines: ModePickPreviewLine[];
  monthly_from: number;
  monthly_to: number;
  monthly_delta_pct: number | null;
};

function tokensByTier(
  usage: Array<{ tier: string; input_tokens: number; output_tokens: number }>
): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of usage) {
    const t = String(u.tier).toUpperCase();
    const tok =
      (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
    m.set(t, (m.get(t) ?? 0) + tok);
  }
  return m;
}

export function estimateMonthlyKrwForPicks(
  picks: Record<LunaTier, MarketModelRow | null>,
  currentByTier: Record<LunaTier, string>,
  market: MarketModelRow[],
  usageTokens: Map<string, number>,
  usdKrw: number,
  daysCovered: number
): number {
  let usd = 0;
  for (const tier of LUNA_TIER_ORDER) {
    const pick =
      picks[tier] ??
      findMarketRow(market, currentByTier[tier] ?? "") ??
      null;
    if (!pick) continue;
    const tok = usageTokens.get(tier) ?? 0;
    const price = blendedUsd(pick);
    if (!Number.isFinite(price) || price <= 0 || !tok) continue;
    usd += (tok / 1_000_000) * price;
  }
  const scale = daysCovered > 0 ? 30 / daysCovered : 30 / 28;
  return Math.round(usd * usdKrw * scale);
}

export function buildModePreview(
  mode: LunaCostMode,
  market: MarketModelRow[],
  tiers: Array<{ tier: string; model_id: string }>,
  usage: Array<{ tier: string; input_tokens: number; output_tokens: number }>,
  usdKrw: number,
  daysCovered = 28,
  monthlyLimitKrw: number | null = null,
  catalog?: ProviderModelCatalog | null,
  mins?: LunaTierMinIntelligence | null
): ModePickPreview {
  const currentByTier = {} as Record<LunaTier, string>;
  for (const t of LUNA_TIER_ORDER) {
    currentByTier[t] =
      String(tiers.find((x) => x.tier === t)?.model_id ?? "") || "";
  }

  const picks = {} as Record<LunaTier, MarketModelRow | null>;
  const lines: ModePickPreviewLine[] = [];
  const tok = tokensByTier(usage);

  for (const tier of LUNA_TIER_ORDER) {
    const currentId = currentByTier[tier];
    const from = findMarketRow(market, currentId);
    const candidate = pickForTierMode(tier, market, mode, catalog, mins);

    let to: MarketModelRow | null = null;
    let reasonNote: string | undefined;
    if (
      candidate &&
      currentId &&
      !slugMatchesModel(candidate.model_slug, currentId)
    ) {
      // 임시 picks로 월 비용 추정
      const trialPicks = { ...picks } as Record<LunaTier, MarketModelRow | null>;
      for (const t of LUNA_TIER_ORDER) {
        if (!trialPicks[t]) {
          trialPicks[t] = findMarketRow(market, currentByTier[t]);
        }
      }
      trialPicks[tier] = candidate;
      const monthlyTo = estimateMonthlyKrwForPicks(
        trialPicks,
        currentByTier,
        market,
        tok,
        usdKrw,
        daysCovered
      );
      const check = validateModeCandidate(tier, candidate, {
        mode,
        from,
        monthlyToKrw: monthlyTo,
        monthlyLimitKrw,
        mins
      });
      if (check.ok) {
        to = candidate;
        reasonNote = check.reasonNote;
      }
    }

    const changed = Boolean(to);
    const effective = (to ?? from) as MarketModelRow | null;
    picks[tier] = effective;

    lines.push({
      tier,
      from_model_id: currentId || "—",
      to_model_id: changed && to ? to.model_slug : currentId || null,
      changed,
      reason:
        changed && to
          ? buildSwapReason(from, to, reasonNote)
          : "변경 없음",
      from_intel: from?.intelligence_index ?? null,
      to_intel: effective?.intelligence_index ?? null,
      from_blended: from ? blendedUsd(from) : null,
      to_blended: effective ? blendedUsd(effective) : null,
      from_ttft: from ? ttftSec(from) : null,
      to_ttft: effective ? ttftSec(effective) : null
    });
  }

  const currentPicks = {} as Record<LunaTier, MarketModelRow | null>;
  for (const tier of LUNA_TIER_ORDER) {
    currentPicks[tier] = findMarketRow(market, currentByTier[tier]);
  }
  const monthly_from = estimateMonthlyKrwForPicks(
    currentPicks,
    currentByTier,
    market,
    tok,
    usdKrw,
    daysCovered
  );
  const monthly_to = estimateMonthlyKrwForPicks(
    picks,
    currentByTier,
    market,
    tok,
    usdKrw,
    daysCovered
  );
  const monthly_delta_pct =
    monthly_from > 0
      ? Math.round(((monthly_to - monthly_from) / monthly_from) * 100)
      : null;

  return {
    mode,
    mode_label: LUNA_COST_MODE_META[mode].label,
    lines,
    monthly_from,
    monthly_to,
    monthly_delta_pct
  };
}

export async function estimateModeMonthlyCosts(
  market: MarketModelRow[],
  tiers: Array<{ tier: string; model_id: string }>,
  usage: Array<{ tier: string; input_tokens: number; output_tokens: number }>,
  usdKrw: number
): Promise<Record<LunaCostMode, number>> {
  const out = {} as Record<LunaCostMode, number>;
  for (const mode of ["cheap", "balanced", "performance"] as LunaCostMode[]) {
    const preview = buildModePreview(mode, market, tiers, usage, usdKrw, 28);
    out[mode] = preview.monthly_to;
  }
  return out;
}

async function periodStats(
  admin: SupabaseClient,
  startIso: string,
  endIso: string | null
): Promise<{
  exam_score: string | null;
  thumbs_up: number;
  thumbs_down: number;
}> {
  const end = endIso ?? new Date().toISOString();

  const { data: runs } = await admin
    .from("luna_eval_runs")
    .select("passed, total, created_at")
    .gte("created_at", startIso)
    .lte("created_at", end)
    .order("created_at", { ascending: false })
    .limit(5);

  let exam_score: string | null = null;
  const run = (runs ?? []).find((r) => Number(r.total) > 0);
  if (run) {
    exam_score = `${Number(run.passed) || 0}/${Number(run.total) || 0}`;
  }

  const { data: msgs } = await admin
    .from("luna_messages")
    .select("meta")
    .gte("created_at", startIso)
    .lte("created_at", end)
    .limit(5000);

  let thumbs_up = 0;
  let thumbs_down = 0;
  for (const m of msgs ?? []) {
    const meta =
      m.meta && typeof m.meta === "object"
        ? (m.meta as Record<string, unknown>)
        : null;
    if (meta?.feedback === "good") thumbs_up += 1;
    if (meta?.feedback === "bad") thumbs_down += 1;
  }

  return { exam_score, thumbs_up, thumbs_down };
}

export async function closeOpenModePeriod(
  admin: SupabaseClient,
  estMonthly: number | null
): Promise<void> {
  const { data: open } = await admin
    .from("luna_model_modes")
    .select("id, started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!open) return;

  const ended = new Date().toISOString();
  const stats = await periodStats(admin, String(open.started_at), ended);
  await admin
    .from("luna_model_modes")
    .update({
      ended_at: ended,
      est_monthly_krw: estMonthly,
      exam_score: stats.exam_score,
      thumbs_up: stats.thumbs_up,
      thumbs_down: stats.thumbs_down
    })
    .eq("id", open.id);
}

export async function openModePeriod(
  admin: SupabaseClient,
  mode: LunaCostMode,
  estMonthly: number | null
): Promise<void> {
  await admin.from("luna_model_modes").insert({
    mode,
    started_at: new Date().toISOString(),
    ended_at: null,
    est_monthly_krw: estMonthly,
    exam_score: null,
    thumbs_up: 0,
    thumbs_down: 0
  });
}

export async function ensureActiveModePeriod(
  admin: SupabaseClient,
  mode: LunaCostMode,
  estMonthly: number | null
): Promise<void> {
  const { data: open } = await admin
    .from("luna_model_modes")
    .select("id")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) return;
  await openModePeriod(admin, mode, estMonthly);
}

export async function loadModeHistory(
  admin: SupabaseClient
): Promise<
  Array<{
    id: string;
    mode: LunaCostMode;
    mode_label: string;
    started_at: string;
    ended_at: string | null;
    est_monthly_krw: number | null;
    exam_score: string | null;
    thumbs_up: number;
    thumbs_down: number;
  }>
> {
  const { data, error } = await admin
    .from("luna_model_modes")
    .select(
      "id, mode, started_at, ended_at, est_monthly_krw, exam_score, thumbs_up, thumbs_down"
    )
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[luna/modes] history", error.message);
    return [];
  }

  const rows = [];
  for (const r of data ?? []) {
    const mode = (
      r.mode === "cheap" || r.mode === "balanced" || r.mode === "performance"
        ? r.mode
        : "balanced"
    ) as LunaCostMode;

    let exam_score = r.exam_score as string | null;
    let thumbs_up = Number(r.thumbs_up) || 0;
    let thumbs_down = Number(r.thumbs_down) || 0;

    if (!r.ended_at) {
      const stats = await periodStats(admin, String(r.started_at), null);
      exam_score = stats.exam_score ?? exam_score;
      thumbs_up = stats.thumbs_up;
      thumbs_down = stats.thumbs_down;
    }

    rows.push({
      id: String(r.id),
      mode,
      mode_label: LUNA_COST_MODE_META[mode].label,
      started_at: String(r.started_at),
      ended_at: r.ended_at ? String(r.ended_at) : null,
      est_monthly_krw:
        r.est_monthly_krw != null ? Number(r.est_monthly_krw) : null,
      exam_score,
      thumbs_up,
      thumbs_down
    });
  }
  return rows;
}

export async function applyCostMode(
  admin: SupabaseClient,
  mode: LunaCostMode,
  market: MarketModelRow[],
  usdKrw: number,
  usage: Array<{ tier: string; input_tokens: number; output_tokens: number }>,
  monthlyLimitKrw: number | null = null,
  catalog?: ProviderModelCatalog | null,
  mins?: LunaTierMinIntelligence | null
): Promise<{ ok: boolean; message: string; preview: ModePickPreview }> {
  const { data: tiers } = await admin
    .from("luna_engine_tiers")
    .select("tier, provider, model_id, model_label");

  const preview = buildModePreview(
    mode,
    market,
    (tiers ?? []).map((t) => ({
      tier: String(t.tier),
      model_id: String(t.model_id)
    })),
    usage,
    usdKrw,
    28,
    monthlyLimitKrw,
    catalog,
    mins
  );

  const currentPicks = {} as Record<LunaTier, MarketModelRow | null>;
  const currentByTier = {} as Record<LunaTier, string>;
  for (const tier of LUNA_TIER_ORDER) {
    const id = String(
      (tiers ?? []).find((t) => t.tier === tier)?.model_id ?? ""
    );
    currentByTier[tier] = id;
    currentPicks[tier] = findMarketRow(market, id);
  }
  const tok = tokensByTier(usage);
  const monthlyFrom = estimateMonthlyKrwForPicks(
    currentPicks,
    currentByTier,
    market,
    tok,
    usdKrw,
    28
  );

  await closeOpenModePeriod(admin, monthlyFrom);
  await openModePeriod(admin, mode, preview.monthly_to);

  for (const line of preview.lines) {
    if (!line.changed || !line.to_model_id) continue;
    const candidate = findMarketRow(market, line.to_model_id);
    if (!candidate) continue;
    const from = findMarketRow(market, String(line.from_model_id));
    const check = validateModeCandidate(line.tier, candidate, {
      mode,
      from,
      monthlyToKrw: preview.monthly_to,
      monthlyLimitKrw,
      mins
    });
    if (!check.ok) continue;
    const current = (tiers ?? []).find((t) => t.tier === line.tier);
    if (!current) continue;

    const toProvider = (candidate.provider ?? "anthropic").toLowerCase();
    const provider = ["openai", "google", "anthropic"].includes(toProvider)
      ? toProvider
      : "anthropic";

    const apiId = apiModelIdForRow(candidate, catalog);
    await admin
      .from("luna_engine_tiers")
      .update({
        provider,
        model_id: apiId,
        model_label: apiId,
        updated_at: new Date().toISOString()
      })
      .eq("tier", line.tier);

    await admin.from("luna_model_changes").insert({
      tier: line.tier,
      from_provider: current.provider,
      from_model_id: current.model_id,
      from_model_label: current.model_label,
      to_provider: provider,
      to_model_id: apiId,
      to_model_label: apiId,
      reason: `모드 변경: ${LUNA_COST_MODE_META[mode].label} · ${line.reason}`,
      savings_krw_month: null,
      exam_result: "pending"
    });
  }

  return {
    ok: true,
    message: `${LUNA_COST_MODE_META[mode].label} 모드로 적용했습니다`,
    preview
  };
}

export function modePickRuleLabel(
  tier: LunaTier,
  mode: LunaCostMode,
  mins?: LunaTierMinIntelligence | null
): string {
  const m = resolveMins(mins);
  const modeLabel = LUNA_COST_MODE_META[mode].label;
  let rule: string;
  if (tier === "S") {
    rule =
      mode === "cheap"
        ? "지능 50 이상 중 최저가"
        : "지능 1위";
  } else if (tier === "A") {
    rule =
      mode === "cheap"
        ? "TTFT 3초 이하 비추론 중 최저가"
        : mode === "balanced"
          ? `지능 상위 ${m.A_percentile}% 중 최저가`
          : "TTFT 3초 이하 비추론 중 최고 지능";
  } else if (tier === "B") {
    rule =
      mode === "performance"
        ? `TTFT 1초 이하·지능 ${m.B} 이상 비추론 중 최고 지능`
        : `TTFT 1초 이하·지능 ${m.B} 이상 비추론 중 최저가`;
  } else {
    rule =
      mode === "cheap"
        ? "지능 20 이상 중 최저가"
        : mode === "balanced"
          ? `지능 ${m.C} 이상 중 최저가`
          : "지능 20 이상 상위 5 중 최저가";
  }
  return `${modeLabel} 모드: ${rule}`;
}

function emptyPoolMessage(
  tier: LunaTier,
  mode: LunaCostMode,
  mins?: LunaTierMinIntelligence | null,
  detail?: "b_same_as_a" | null
): string {
  const m = resolveMins(mins);
  if (tier === "B" && detail === "b_same_as_a") {
    return "B등급 조건을 만족하면서 A와 다른 모델이 없어 현재를 유지합니다";
  }
  if (tier === "A") {
    return "TTFT 3초 이하인 비추론 모델이 없어요";
  }
  if (tier === "B") {
    return `TTFT 1초 이하이면서 지능 ${m.B} 이상인 모델이 없어요`;
  }
  if (tier === "C") {
    if (mode === "balanced") return `지능 ${m.C} 이상인 모델이 없어요`;
    return "지능 20 이상인 모델이 없어요";
  }
  if (mode === "cheap") return "지능 50 이상인 모델이 없어요";
  return "조건을 만족하는 후보가 없어요";
}

function poolForTierExplain(
  tier: LunaTier,
  rows: MarketModelRow[],
  mode: LunaCostMode,
  catalog?: ProviderModelCatalog | null,
  mins?: LunaTierMinIntelligence | null
): MarketModelRow[] {
  const m = resolveMins(mins);
  if (tier === "A") {
    const a = poolA(rows, catalog);
    if (mode === "balanced") return topPercentileByIntel(a, m.A_percentile);
    return a;
  }
  if (tier === "B") {
    const aPick = pickForTierMode("A", rows, mode, catalog, mins);
    let b = poolB(rows, catalog, m.B);
    if (aPick) {
      b = b.filter((r) => !slugMatchesModel(r.model_slug, aPick.model_slug));
    }
    return b;
  }
  const pool = preferredOnly(rows, catalog);
  if (tier === "S") {
    if (mode === "cheap") return pool.filter((r) => intel(r) >= 50);
    return pool;
  }
  if (mode === "cheap") return pool.filter((r) => intel(r) >= 20);
  if (mode === "balanced") return pool.filter((r) => intel(r) >= m.C);
  return topNByIntel(
    pool.filter((r) => intel(r) >= 20),
    5
  );
}

function sortPoolForMode(
  tier: LunaTier,
  pool: MarketModelRow[],
  mode: LunaCostMode
): MarketModelRow[] {
  const byPrice = (a: MarketModelRow, b: MarketModelRow) =>
    blendedUsd(a) - blendedUsd(b) || intel(b) - intel(a);
  const byIntel = (a: MarketModelRow, b: MarketModelRow) =>
    intel(b) - intel(a) || blendedUsd(a) - blendedUsd(b);

  if (tier === "S") {
    if (mode === "cheap") return [...pool].sort(byPrice);
    return [...pool].sort(byIntel);
  }
  if (tier === "A") {
    if (mode === "performance") return [...pool].sort(byIntel);
    return [...pool].sort(byPrice);
  }
  if (tier === "B") {
    if (mode === "performance") return [...pool].sort(byIntel);
    return [...pool].sort(byPrice);
  }
  return [...pool].sort(byPrice);
}

function formatSwapSummaryLine(
  from: MarketModelRow | null,
  to: MarketModelRow,
  modeNote: string
): string {
  const fi = from?.intelligence_index ?? null;
  const ti = to.intelligence_index;
  const fb = from ? blendedUsd(from) : null;
  const tb = blendedUsd(to);
  const ft = from ? ttftSec(from) : null;
  const tt = ttftSec(to);

  const intelPct =
    fi != null && Number(fi) > 0 && ti != null
      ? Math.round(((Number(ti) - Number(fi)) / Number(fi)) * 100)
      : null;
  const pricePct =
    fb != null && Number.isFinite(fb) && fb > 0 && Number.isFinite(tb)
      ? Math.round(((tb - fb) / fb) * 100)
      : null;

  const pct = (n: number) =>
    n >= 0 ? `+${n}%` : `−${Math.abs(n)}%`;

  const intelPart = `지능 ${fmtNum(fi, 1)}→${fmtNum(ti, 1)}${
    intelPct != null ? `(${pct(intelPct)})` : ""
  }`;
  const pricePart = `가격 ${
    fb != null && Number.isFinite(fb) ? fmtUsd(fb) : "—"
  }→${Number.isFinite(tb) ? fmtUsd(tb) : "—"}${
    pricePct != null ? `(${pct(pricePct)})` : ""
  }`;
  const ttftPart = `TTFT ${
    ft != null ? `${fmtNum(ft, 2)}` : "—"
  }→${tt != null ? `${fmtNum(tt, 2)}` : "—"}초`;

  return `${intelPart} · ${pricePart} · ${ttftPart} — ${modeNote}`;
}

function candidateShort(row: MarketModelRow): string {
  const p = blendedUsd(row);
  return `${row.model_slug} (지능 ${fmtNum(row.intelligence_index, 1)} · ${
    Number.isFinite(p) ? fmtUsd(p) : "—"
  })`;
}

export type TierExplainCandidate = {
  model_slug: string;
  provider: string;
  intelligence_index: number | null;
  price_blended: number | null;
  ttft: number | null;
  status: string;
};

export type TierExplanation = {
  tier: LunaTier;
  summary: string;
  candidate_slug: string | null;
  candidate_provider: string | null;
  show_apply: boolean;
  candidates: TierExplainCandidate[];
};

export function explainTierSelections(
  market: MarketModelRow[],
  tiers: Array<{ tier: string; model_id: string }>,
  opts: {
    mode: LunaCostMode;
    auto_swap: boolean;
    protect_s: boolean;
    monthlyLimitKrw?: number | null;
    catalog?: ProviderModelCatalog | null;
    mins?: LunaTierMinIntelligence | null;
  }
): TierExplanation[] {
  const mode = opts.mode;
  const catalog = opts.catalog ?? null;
  const mins = opts.mins ?? null;
  const m = resolveMins(mins);
  const out: TierExplanation[] = [];

  for (const tier of LUNA_TIER_ORDER) {
    const currentId =
      String(tiers.find((x) => x.tier === tier)?.model_id ?? "") || "";
    const from = findMarketRow(market, currentId);
    const pick = pickForTierMode(tier, market, mode, catalog, mins);
    const rule = modePickRuleLabel(tier, mode, mins);

    // 설명용 풀: A는 전체 조건 풀(백분위 탈락 표시), 나머지는 선정 풀
    let displayPool: MarketModelRow[];
    if (tier === "A") {
      displayPool = [...poolA(market, catalog)].sort(
        (a, b) => intel(b) - intel(a) || blendedUsd(a) - blendedUsd(b)
      );
    } else {
      displayPool = sortPoolForMode(
        tier,
        poolForTierExplain(tier, market, mode, catalog, mins),
        mode
      );
    }
    const aTop =
      tier === "A" && mode === "balanced"
        ? new Set(
            topPercentileByIntel(poolA(market, catalog), m.A_percentile).map(
              (r) => r.model_slug
            )
          )
        : null;

    const candidates: TierExplainCandidate[] = displayPool
      .slice(0, 5)
      .map((r) => {
        const price = blendedUsd(r);
        let status = "후보";
        if (pick && slugMatchesModel(r.model_slug, pick.model_slug)) {
          status = "선정";
        } else if (aTop && !aTop.has(r.model_slug)) {
          status = `탈락(지능 상위 ${m.A_percentile}% 미달)`;
        } else if (from && slugMatchesModel(r.model_slug, currentId)) {
          status = "현재 사용";
        } else {
          const check = validateModeCandidate(tier, r, {
            mode,
            from,
            monthlyLimitKrw: opts.monthlyLimitKrw ?? null,
            mins
          });
          if (!check.ok) status = check.reason;
          else if (pick) status = "순위 하위(더 저렴·적합 후보 있음)";
          else status = "후보";
        }
        return {
          model_slug: r.model_slug,
          provider: (r.provider ?? "other").toLowerCase(),
          intelligence_index: r.intelligence_index,
          price_blended: Number.isFinite(price) ? price : null,
          ttft: ttftSec(r),
          status
        };
      });

    let summary: string;
    let candidate_slug: string | null = null;
    let candidate_provider: string | null = null;
    let show_apply = false;

    if (!pick) {
      let detail: "b_same_as_a" | null = null;
      if (tier === "B") {
        const aPick = pickForTierMode("A", market, mode, catalog, mins);
        const rawB = poolB(market, catalog, m.B);
        if (
          aPick &&
          rawB.some((r) => slugMatchesModel(r.model_slug, aPick.model_slug)) &&
          rawB.filter(
            (r) => !slugMatchesModel(r.model_slug, aPick.model_slug)
          ).length === 0
        ) {
          detail = "b_same_as_a";
        }
      }
      summary = emptyPoolMessage(tier, mode, mins, detail);
    } else if (currentId && slugMatchesModel(pick.model_slug, currentId)) {
      const second = displayPool.find(
        (r) => !slugMatchesModel(r.model_slug, pick.model_slug)
      );
      summary = second
        ? `현재가 최적입니다. 2위 후보 ${candidateShort(second)}보다 낫습니다`
        : "현재가 최적입니다";
    } else {
      const check = validateModeCandidate(tier, pick, {
        mode,
        from,
        monthlyLimitKrw: opts.monthlyLimitKrw ?? null,
        mins
      });
      if (!check.ok) {
        const reason = check.reason;
        if (/가격|배|한도|상승/.test(reason)) {
          summary = `후보 ${pick.model_slug} 가 있으나 ${reason.replace(/^가성비:\s*/, "").replace(/^가격 우선:\s*/, "").replace(/^성능 우선:\s*/, "")} 제외됐어요 (${LUNA_COST_MODE_META[mode].label} 모드 한도)`;
          if (reason.includes("2") || reason.includes("200")) {
            summary = `후보 ${pick.model_slug} 가 있으나 가격이 2배를 넘어 제외됐어요 (${LUNA_COST_MODE_META[mode].label} 모드 한도)`;
          }
        } else {
          summary = `후보 ${pick.model_slug} 가 있으나 ${reason}으로 제외됐어요`;
        }
      } else if (tier === "S" && opts.protect_s) {
        candidate_slug = apiModelIdForRow(pick, catalog);
        candidate_provider = (pick.provider ?? "").toLowerCase();
        show_apply = true;
        summary = `S 등급은 보호되어 자동 교체하지 않습니다. 후보: ${candidateShort(pick)}`;
      } else if (!opts.auto_swap) {
        candidate_slug = apiModelIdForRow(pick, catalog);
        candidate_provider = (pick.provider ?? "").toLowerCase();
        show_apply = true;
        summary = `자동 교체가 꺼져 있어요. 후보: ${candidateShort(pick)}`;
      } else {
        summary = formatSwapSummaryLine(from, pick, rule);
        candidate_slug = apiModelIdForRow(pick, catalog);
        candidate_provider = (pick.provider ?? "").toLowerCase();
      }
    }

    out.push({
      tier,
      summary,
      candidate_slug,
      candidate_provider,
      show_apply,
      candidates
    });
  }

  return out;
}
