"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { brainFetch, BtnRow, formatTokens } from "@/components/luna/brain/shared";
import type {
  LunaCostMode,
  LunaModelCostSettings,
  LunaUsageAlerts
} from "@/lib/luna/brain-models";
import { LUNA_COST_MODE_META } from "@/lib/luna/brain-models";
import { K } from "@/lib/luna/knowledge-format";

type TierView = {
  tier: string;
  provider: string;
  model_id: string;
  model_label: string;
  week_cost: number;
  change_badge: string;
  meta: { name: string; desc: string } | null;
  selectable: Array<{
    provider: string;
    model_id: string;
    model_label: string;
  }>;
};

type MarketRow = {
  model_slug: string;
  provider: string | null;
  brand: string;
  intelligence_index: number | null;
  multilingual_index: number | null;
  agentic_index: number | null;
  cost_krw: number | null;
  price_blended?: number | null;
  median_time_to_first_token_seconds?: number | null;
  median_output_tokens_per_second?: number | null;
  is_reasoning?: boolean | null;
  our_tiers: string[];
  value?: number;
};

type SelectableModel = {
  model_slug: string;
  provider: string;
  brand: string;
  intelligence_index: number | null;
  multilingual_index: number | null;
  agentic_index: number | null;
  price_blended: number | null;
  cost_krw: number | null;
  median_time_to_first_token_seconds: number | null;
  median_output_tokens_per_second: number | null;
  is_reasoning: boolean | null;
  disabled: boolean;
  disabled_reason: string | null;
};

type ModePreview = {
  mode: LunaCostMode;
  mode_label: string;
  lines: Array<{
    tier: string;
    from_model_id: string;
    to_model_id: string | null;
    changed: boolean;
    reason: string;
  }>;
  monthly_from: number;
  monthly_to: number;
  monthly_delta_pct: number | null;
};

type Payload = {
  connections: {
    anthropic: boolean;
    openai: boolean;
    google: boolean;
    artificial_analysis: boolean;
  };
  fx: { usd_krw: number; date: string | null };
  mode: LunaCostMode;
  mode_estimates: Record<LunaCostMode, number>;
  mode_history: Array<{
    id: string;
    mode: LunaCostMode;
    mode_label: string;
    started_at: string;
    ended_at: string | null;
    est_monthly_krw: number | null;
    exam_score: string | null;
    thumbs_up: number;
    thumbs_down: number;
  }>;
  tiers: TierView[];
  market: {
    fetched_at: string | null;
    missing_key: boolean;
    error: string | null;
    total_count?: number;
    rows: MarketRow[];
  };
  selectable?: SelectableModel[];
  ranking: Array<{
    rank: number;
    model_slug: string;
    brand: string;
    intelligence_index: number | null;
    multilingual_index: number | null;
    agentic_index: number | null;
    cost_krw: number | null;
    value: number;
    our_tiers: string[];
    delta: number | null;
  }>;
  history: Array<{
    model_slug: string;
    brand: string;
    cost_krw: number | null;
    fetched_at: string;
  }>;
  history_weeks?: number;
  price_note: string | null;
  usage: {
    range: number;
    has_feature: boolean;
    week_cost: number;
    week_change_pct: number | null;
    week_calls: number;
    week_tokens: number;
    month_estimate: number;
    pricing_source: "official" | "market";
    by_feature: Array<{
      tier: string;
      feature: string;
      feature_label: string;
      model_id: string;
      calls: number;
      tokens: number;
      cost: number;
      share: number;
    }>;
  };
  changes: Array<{
    id: string;
    tier: string;
    from_model_label: string | null;
    to_model_label: string;
    reason: string | null;
    savings_krw_month: number | null;
    exam_result: string | null;
    exam_note: string | null;
    reverted: boolean;
    created_at: string;
  }>;
  settings: LunaModelCostSettings;
  alerts: LunaUsageAlerts;
};

const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  S: { bg: "#EDE4FA", color: "#5B3B96" },
  A: { bg: "#EEEDFE", color: "#3C3489" },
  B: { bg: "#E1F5EE", color: "#0F6E56" },
  C: { bg: "#FAEEDA", color: "#633806" }
};

function Brand({ brand }: { brand: string }) {
  const style =
    brand === "Claude"
      ? { color: "#A34F32", border: "#E8CFC2" }
      : brand === "GPT"
        ? { color: "#0F7A5C", border: "#C4E0D2" }
        : brand === "Gemini"
          ? { color: "#3B6396", border: "#C7D5E8" }
          : { color: K.sub, border: K.line };
  return (
    <span
      className="rounded px-[5px] py-0.5 text-[9px] font-bold tracking-wide"
      style={{ color: style.color, border: `1px solid ${style.border}` }}
    >
      {brand}
    </span>
  );
}

function TierBadge({ tier, size = 24 }: { tier: string; size?: number }) {
  const s = TIER_STYLE[tier] ?? TIER_STYLE.A!;
  return (
    <span
      className="inline-grid place-items-center rounded-[7px] text-[11.5px] font-extrabold"
      style={{
        width: size,
        height: size,
        background: s.bg,
        color: s.color,
        fontSize: size < 22 ? 10 : 11.5
      }}
    >
      {tier}
    </span>
  );
}

function fmtWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function LunaBrainModel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState<"intel" | "multi" | "agent">("intel");
  const [priceScale, setPriceScale] = useState<"linear" | "log">("linear");
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const [rankOpen, setRankOpen] = useState(false);
  const [settings, setSettings] = useState<LunaModelCostSettings | null>(null);
  const [alerts, setAlerts] = useState<LunaUsageAlerts | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hoverSlug, setHoverSlug] = useState<string | null>(null);
  const [modePreview, setModePreview] = useState<ModePreview | null>(null);

  const load = useCallback(async (r: string = range) => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<Payload>(
        `/api/luna/brain/model-cost?range=${r}`
      );
      setData(json);
      setSettings(json.settings);
      setAlerts(json.alerts);
      setDrafts({});
      setModePreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  async function runInspect() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{
        message: string;
        market_error?: string | null;
        ok?: boolean;
      }>("/api/luna/brain/model-cost", {
        method: "POST",
        body: JSON.stringify({ action: "inspect" })
      });
      setNotice(res.market_error || res.message);
      await load(range);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "점검 실패");
      await load(range);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!settings || !alerts) return;
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/brain/model-cost", {
        method: "PATCH",
        body: JSON.stringify({ settings, alerts })
      });
      setNotice("설정을 저장했습니다. 한도를 넘으면 알림만 보냅니다. 서비스는 중단되지 않아요.");
      await load(range);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function previewMode(mode: LunaCostMode) {
    if (!data || mode === data.mode) {
      setModePreview(null);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ preview: ModePreview }>(
        "/api/luna/brain/model-cost",
        {
          method: "POST",
          body: JSON.stringify({ action: "preview_mode", mode })
        }
      );
      setModePreview(res.preview);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "미리보기 실패");
    } finally {
      setBusy(false);
    }
  }

  async function applyMode() {
    if (!modePreview) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ message: string }>(
        "/api/luna/brain/model-cost",
        {
          method: "POST",
          body: JSON.stringify({
            action: "apply_mode",
            mode: modePreview.mode
          })
        }
      );
      setNotice(res.message);
      setModePreview(null);
      await load(range);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "모드 적용 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveTier(tier: string) {
    const modelId = drafts[tier];
    if (!modelId || !data) return;
    const opt = (data.selectable ?? []).find((s) => s.model_slug === modelId);
    if (!opt || opt.disabled) {
      setNotice(opt?.disabled_reason ?? "선택할 수 없는 모델입니다");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ message?: string }>(
        "/api/luna/brain/model-cost",
        {
          method: "PATCH",
          body: JSON.stringify({
            tier_update: {
              tier,
              model_id: modelId,
              provider: opt.provider
            }
          })
        }
      );
      setNotice(
        res.message ??
          `${tier}등급을 ${modelId}로 바꿨어요. 회귀 시험으로 확인해 보세요`
      );
      await load(range);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const scatter = useMemo(() => {
    const rows = data?.market.rows ?? [];
    if (rows.length === 0) return { points: [], xTicks: [] as number[], yTicks: [] as number[], metricLabel: "" };

    const metricLabel =
      metric === "multi"
        ? "다국어 지수"
        : metric === "agent"
          ? "에이전트 지수"
          : "종합 지능 지수";

    const scored = rows.map((r) => {
      const score =
        metric === "multi"
          ? Number(r.multilingual_index) || 0
          : metric === "agent"
            ? Number(r.agentic_index) || 0
            : Number(r.intelligence_index) || 0;
      const cost = r.cost_krw ?? 0;
      return { ...r, score, cost };
    });

    const costs = scored.map((r) => r.cost).filter((n) => n > 0);
    const scores = scored.map((r) => r.score);
    let minC = Math.min(...(costs.length ? costs : [0]));
    let maxC = Math.max(...(costs.length ? costs : [1]));
    let minS = Math.min(...scores);
    let maxS = Math.max(...scores);
    if (minC === maxC) {
      minC = Math.max(0, minC * 0.9);
      maxC = maxC * 1.1 || 1;
    }
    if (minS === maxS) {
      minS = minS - 5;
      maxS = maxS + 5;
    }
    const padC = (maxC - minC) * 0.05;
    const padS = (maxS - minS) * 0.05 || 1;
    minC = Math.max(0, minC - padC);
    maxC = maxC + padC;
    minS = minS - padS;
    maxS = maxS + padS;

    const mapX = (c: number) => {
      if (priceScale === "log") {
        const lo = Math.log10(Math.max(minC, 1));
        const hi = Math.log10(Math.max(maxC, 10));
        const v = Math.log10(Math.max(c, 1));
        return ((v - lo) / Math.max(hi - lo, 1e-9)) * 100;
      }
      return ((c - minC) / Math.max(maxC - minC, 1)) * 100;
    };
    const mapY = (s: number) =>
      ((s - minS) / Math.max(maxS - minS, 1)) * 100;

    const xTicks =
      priceScale === "log"
        ? [minC, Math.sqrt(minC * maxC) || (minC + maxC) / 2, maxC].map((n) =>
            Math.round(n)
          )
        : [minC, (minC + maxC) / 2, maxC].map((n) => Math.round(n));
    const yTicks = [minS, (minS + maxS) / 2, maxS].map(
      (n) => Math.round(n * 10) / 10
    );

    const byValue = [...scored].sort(
      (a, b) => (b.value ?? 0) - (a.value ?? 0)
    );
    const labelSlugs = new Set(
      [
        ...byValue.slice(0, 5).map((r) => r.model_slug),
        ...scored.filter((r) => r.our_tiers.length > 0).map((r) => r.model_slug)
      ]
    );

    const points = scored.map((r) => ({
      ...r,
      x: Math.min(100, Math.max(0, mapX(Math.max(r.cost, minC)))),
      y: Math.min(100, Math.max(0, mapY(r.score))),
      showLabel: labelSlugs.has(r.model_slug)
    }));

    return { points, xTicks, yTicks, metricLabel, minC, maxC, minS, maxS };
  }, [data?.market.rows, metric, priceScale]);

  const rankingVisible = rankOpen
    ? data?.ranking ?? []
    : (data?.ranking ?? []).slice(0, 7);
  const rankingRest = Math.max(0, (data?.ranking.length ?? 0) - 7);

  return (
    <KnowledgeShell>
      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && data ? (
        <div className="space-y-[22px]">
          {/* 0. 모드 토글 */}
          <section>
            <div
              className="rounded-xl border px-[18px] py-4"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="inline-flex overflow-hidden rounded-xl border" style={{ borderColor: K.line }}>
                  {(
                    [
                      ["cheap", "가격 우선"],
                      ["balanced", "가성비"],
                      ["performance", "성능 우선"]
                    ] as const
                  ).map(([key, label]) => {
                    const active = (modePreview?.mode ?? data.mode) === key;
                    const est = data.mode_estimates?.[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={busy}
                        onClick={() => void previewMode(key)}
                        className="min-w-[108px] cursor-pointer px-3.5 py-2.5 text-center"
                        style={{
                          background: active ? K.luna : "transparent",
                          color: active ? "#fff" : K.ink
                        }}
                      >
                        <div className="text-[13px] font-semibold">{label}</div>
                        <div
                          className="mt-0.5 text-[11px]"
                          style={{ color: active ? "rgba(255,255,255,0.85)" : K.faint }}
                        >
                          월 {fmtWon(est ?? 0)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="min-w-0 flex-1 pt-1 text-[12.5px]" style={{ color: K.sub }}>
                  {
                    LUNA_COST_MODE_META[
                      (modePreview?.mode ?? data.mode) as LunaCostMode
                    ]?.desc
                  }
                </p>
              </div>

              {modePreview ? (
                <div
                  className="mt-4 rounded-[10px] border px-3.5 py-3"
                  style={{ borderColor: K.line2, background: "#FBFAFF" }}
                >
                  <div className="mb-2 text-[13px] font-semibold">
                    {modePreview.mode_label} 모드로 바꾸면
                  </div>
                  <div className="space-y-1.5 text-[12.5px]">
                    {modePreview.lines.map((line) => (
                      <div
                        key={line.tier}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                      >
                        <TierBadge tier={line.tier} size={18} />
                        <span className="font-mono text-[12px]">
                          {line.from_model_id}
                        </span>
                        <span style={{ color: K.faint }}>→</span>
                        {line.changed ? (
                          <>
                            <span className="font-mono text-[12px] font-semibold">
                              {line.to_model_id}
                            </span>
                            <span style={{ color: K.sub }}>{line.reason}</span>
                          </>
                        ) : (
                          <span style={{ color: K.faint }}>변경 없음</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-[12.5px]">
                    월 예상 비용{" "}
                    <b>{fmtWon(modePreview.monthly_from)}</b>
                    <span style={{ color: K.faint }}> → </span>
                    <b>{fmtWon(modePreview.monthly_to)}</b>
                    {modePreview.monthly_delta_pct != null ? (
                      <span
                        className="ml-1.5 text-[11.5px] font-semibold"
                        style={{
                          color:
                            modePreview.monthly_delta_pct > 0
                              ? "#A32D2D"
                              : "#0F6E56"
                        }}
                      >
                        ({modePreview.monthly_delta_pct > 0 ? "▲" : "▼"}
                        {Math.abs(modePreview.monthly_delta_pct)}%)
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn primary disabled={busy} onClick={() => void applyMode()}>
                      이 모드로 적용
                    </Btn>
                    <Btn disabled={busy} onClick={() => setModePreview(null)}>
                      취소
                    </Btn>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* 1. 지금 쓰는 모델 */}
          <section>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
              <h3 className="text-[14px] font-bold">지금 쓰는 모델</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                주 1회 자동 점검 후 가성비 기준으로 교체됩니다
              </span>
              <span
                className="ml-auto text-[11.5px]"
                style={{ color: K.faint }}
              >
                마지막 점검 {shortDate(data.settings.last_inspect_at)} · 다음{" "}
                {shortDate(data.settings.next_inspect_at)} ·{" "}
                <button
                  type="button"
                  className="cursor-pointer"
                  style={{ color: K.luna }}
                  disabled={busy}
                  onClick={() => void runInspect()}
                >
                  지금 점검
                </button>
              </span>
            </div>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {data.tiers.map((t) => {
                const draft = drafts[t.tier] ?? t.model_id;
                const dirty = draft !== t.model_id;
                const groups = [
                  {
                    label: "Claude",
                    items: (data.selectable ?? []).filter(
                      (s) => s.brand === "Claude"
                    )
                  },
                  {
                    label: "GPT",
                    items: (data.selectable ?? []).filter(
                      (s) => s.brand === "GPT"
                    )
                  },
                  {
                    label: "Gemini",
                    items: (data.selectable ?? []).filter(
                      (s) => s.brand === "Gemini"
                    )
                  }
                ];
                return (
                  <div
                    key={t.tier}
                    className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3 last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <TierBadge tier={t.tier} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold">
                        {t.meta?.name ?? t.tier}
                      </div>
                      <div className="text-[11.5px]" style={{ color: K.sub }}>
                        {t.meta?.desc}
                      </div>
                    </div>
                    <select
                      className="max-w-[min(420px,100%)] rounded-lg border bg-white px-2 py-1.5 font-mono text-[12px]"
                      style={{ borderColor: K.line, color: K.ink }}
                      value={draft}
                      disabled={busy}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [t.tier]: e.target.value }))
                      }
                    >
                      {!groups.some((g) =>
                        g.items.some((i) => i.model_slug === draft)
                      ) ? (
                        <option value={draft}>{draft || "—"}</option>
                      ) : null}
                      {groups.map((g) =>
                        g.items.length ? (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((s) => {
                              const ttft =
                                s.median_time_to_first_token_seconds != null
                                  ? `${Number(s.median_time_to_first_token_seconds).toFixed(1)}초`
                                  : "—";
                              const price =
                                s.price_blended != null
                                  ? `$${Number(s.price_blended).toFixed(2)}`
                                  : "—";
                              const label = `${s.model_slug} · 지능 ${s.intelligence_index ?? "—"} · ${price} · ${ttft}${
                                s.disabled
                                  ? ` (${s.disabled_reason ?? "비활성"})`
                                  : ""
                              }`;
                              return (
                                <option
                                  key={s.model_slug}
                                  value={s.model_slug}
                                  disabled={s.disabled}
                                >
                                  {label}
                                </option>
                              );
                            })}
                          </optgroup>
                        ) : null
                      )}
                    </select>
                    {dirty ? (
                      <Btn
                        primary
                        disabled={busy}
                        onClick={() => void saveTier(t.tier)}
                      >
                        저장
                      </Btn>
                    ) : null}
                    <span
                      className="rounded-[10px] px-[7px] py-px text-[10.5px]"
                      style={{
                        background:
                          t.change_badge === "유지" ? K.chip : "#E1F5EE",
                        color: t.change_badge === "유지" ? K.faint : "#0F6E56"
                      }}
                    >
                      {t.change_badge}
                    </span>
                    <div className="w-24 text-right text-[12.5px]">
                      <b className="font-semibold">{fmtWon(t.week_cost)}</b>
                      <span
                        className="block text-[10.5px]"
                        style={{ color: K.faint }}
                      >
                        이번 주
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 2. 시장 현황 */}
          <section>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
              <h3 className="text-[14px] font-bold">시장 현황</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                표시 상위 15개
                {data.market.total_count
                  ? ` · 후보 ${data.market.total_count}개`
                  : ""}{" "}
                · Artificial Analysis
              </span>
              <span
                className="ml-auto text-[11.5px]"
                style={{ color: K.faint }}
              >
                {data.market.fetched_at
                  ? `${shortDate(data.market.fetched_at)} 갱신 · `
                  : ""}
                환율 ₩{Math.round(data.fx.usd_krw).toLocaleString("ko-KR")}/USD
                {data.fx.date ? ` (${shortDate(data.fx.date)})` : ""}
              </span>
            </div>
            <div
              className="rounded-xl border px-[18px] py-4"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {data.market.error || data.market.missing_key ? (
                <p className="py-10 text-center text-[13px]" style={{ color: K.sub }}>
                  {data.market.error ??
                    "Artificial Analysis API 키가 필요합니다"}
                </p>
              ) : data.market.rows.length === 0 ? (
                <p className="py-10 text-center text-[13px]" style={{ color: K.sub }}>
                  시장 데이터가 없습니다. [지금 점검]을 눌러 주세요.
                </p>
              ) : (
                <>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                    <span className="text-[12px]" style={{ color: K.sub }}>
                      성능 축
                    </span>
                    {(
                      [
                        ["intel", "종합 지능"],
                        ["multi", "다국어"],
                        ["agent", "에이전트"]
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setMetric(k)}
                        className="cursor-pointer rounded-full px-2.5 py-[3px] text-[11px]"
                        style={{
                          background: metric === k ? K.luna : K.chip,
                          color: metric === k ? "#fff" : K.sub,
                          fontWeight: metric === k ? 600 : 400
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="ml-2 text-[12px]" style={{ color: K.sub }}>
                      가격 축
                    </span>
                    {(
                      [
                        ["linear", "선형"],
                        ["log", "로그"]
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPriceScale(k)}
                        className="cursor-pointer rounded-full px-2.5 py-[3px] text-[11px]"
                        style={{
                          background: priceScale === k ? K.luna : K.chip,
                          color: priceScale === k ? "#fff" : K.sub,
                          fontWeight: priceScale === k ? 600 : 400
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <span
                      className="ml-auto text-[11px]"
                      style={{ color: K.faint }}
                    >
                      왼쪽 위일수록 가성비가 좋습니다
                    </span>
                  </div>
                  <div className="relative mt-1 pl-12 pr-2">
                    <div
                      className="pointer-events-none absolute left-0 top-1/2 origin-center -translate-y-1/2 -rotate-90 whitespace-nowrap text-[10.5px]"
                      style={{ color: K.faint }}
                    >
                      {scatter.metricLabel}
                    </div>
                    <div
                      className="relative h-[300px] border-b border-l"
                      style={{ borderColor: K.line }}
                    >
                      {scatter.yTicks.map((tick, i) => {
                        const y =
                          scatter.yTicks.length <= 1
                            ? 50
                            : (i / (scatter.yTicks.length - 1)) * 100;
                        return (
                          <div
                            key={`y-${tick}-${i}`}
                            className="absolute left-0 right-0 border-t border-dashed"
                            style={{ bottom: `${y}%`, borderColor: K.line2 }}
                          >
                            <span
                              className="absolute -left-11 -translate-y-1/2 text-[10px]"
                              style={{ color: K.faint }}
                            >
                              {tick}
                            </span>
                          </div>
                        );
                      })}
                      {scatter.points.map((d) => (
                        <div
                          key={d.model_slug}
                          className="absolute"
                          style={{
                            left: `${d.x}%`,
                            bottom: `${d.y}%`,
                            transform: "translate(-50%, 50%)"
                          }}
                          onMouseEnter={() => setHoverSlug(d.model_slug)}
                          onMouseLeave={() => setHoverSlug(null)}
                        >
                          <div
                            className="rounded-full"
                            style={{
                              width: d.our_tiers.length ? 15 : 11,
                              height: d.our_tiers.length ? 15 : 11,
                              background:
                                d.brand === "Claude"
                                  ? "#C96442"
                                  : d.brand === "GPT"
                                    ? "#0F9D77"
                                    : "#3B6396",
                              boxShadow: d.our_tiers.length
                                ? "0 0 0 2px #534AB7"
                                : undefined,
                              border: d.our_tiers.length
                                ? "3px solid #fff"
                                : undefined
                            }}
                          />
                          {d.showLabel ? (
                            <div
                              className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[9.5px]"
                              style={{ color: K.sub }}
                            >
                              {d.model_slug.split("/").pop()}
                              {d.our_tiers.length
                                ? ` · ${d.our_tiers.join("")}`
                                : ""}
                            </div>
                          ) : null}
                          {hoverSlug === d.model_slug ? (
                            <div
                              className="absolute bottom-full left-1/2 z-10 mb-2 w-[220px] -translate-x-1/2 rounded-lg border bg-white px-2.5 py-2 text-left text-[11px] shadow-md"
                              style={{ borderColor: K.line, color: K.ink }}
                            >
                              <div className="font-semibold">
                                {d.model_slug}
                              </div>
                              <div style={{ color: K.sub }}>{d.brand}</div>
                              <div className="mt-1 space-y-0.5" style={{ color: K.sub }}>
                                <div>지능 {d.intelligence_index ?? "—"}</div>
                                <div>다국어 {d.multilingual_index ?? "—"}</div>
                                <div>에이전트 {d.agentic_index ?? "—"}</div>
                                <div>혼합가 {fmtWon(d.cost_krw)}</div>
                                <div>
                                  TTFT{" "}
                                  {d.median_time_to_first_token_seconds != null
                                    ? `${Number(d.median_time_to_first_token_seconds).toFixed(2)}s`
                                    : "—"}
                                </div>
                                <div>
                                  출력{" "}
                                  {d.median_output_tokens_per_second != null
                                    ? `${Math.round(Number(d.median_output_tokens_per_second))} t/s`
                                    : "—"}
                                </div>
                                {d.our_tiers.length ? (
                                  <div style={{ color: K.luna }}>
                                    지금 {d.our_tiers.join(", ")}등급
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="relative mt-1 h-4">
                      {scatter.xTicks.map((tick, i) => {
                        const x =
                          scatter.xTicks.length <= 1
                            ? 50
                            : (i / (scatter.xTicks.length - 1)) * 100;
                        return (
                          <span
                            key={`x-${tick}-${i}`}
                            className="absolute -translate-x-1/2 text-[10px]"
                            style={{ left: `${x}%`, color: K.faint }}
                          >
                            {fmtWon(tick)}
                          </span>
                        );
                      })}
                    </div>
                    <div
                      className="mt-3 text-center text-[10.5px]"
                      style={{ color: K.faint }}
                    >
                      100만 토큰당 비용 (원)
                    </div>
                  </div>
                  <div
                    className="mt-3 flex justify-center gap-3.5 text-[11px]"
                    style={{ color: K.sub }}
                  >
                    <span>
                      <i
                        className="mr-1 inline-block h-[9px] w-[9px] rounded-full"
                        style={{ background: "#C96442" }}
                      />
                      Claude
                    </span>
                    <span>
                      <i
                        className="mr-1 inline-block h-[9px] w-[9px] rounded-full"
                        style={{ background: "#0F9D77" }}
                      />
                      GPT
                    </span>
                    <span>
                      <i
                        className="mr-1 inline-block h-[9px] w-[9px] rounded-full"
                        style={{ background: "#3B6396" }}
                      />
                      Gemini
                    </span>
                    <span>
                      <i
                        className="mr-1 inline-block h-[9px] w-[9px] rounded-full bg-white"
                        style={{ boxShadow: "0 0 0 2px #534AB7" }}
                      />
                      지금 쓰는 것
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 3. 순위 */}
          <section>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h3 className="text-[14px] font-bold">순위</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                가성비 = 성능 ÷ 비용 · 지난주 대비 변동
              </span>
            </div>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {data.market.error ||
              (data.market.missing_key && data.ranking.length === 0) ? (
                <p className="px-4 py-8 text-center text-[13px]" style={{ color: K.sub }}>
                  {data.market.error ??
                    "Artificial Analysis API 키가 필요합니다"}
                </p>
              ) : data.ranking.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px]" style={{ color: K.sub }}>
                  순위 데이터가 없습니다. [지금 점검]을 눌러 주세요.
                </p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["", "모델", "종합", "다국어", "에이전트", "100만 토큰", "가성비", "변동"].map(
                        (h, i) => (
                          <th
                            key={h || "r"}
                            className={`border-b px-2.5 py-2 text-[10.5px] font-semibold ${i >= 2 ? "text-right" : "text-left"}`}
                            style={{ color: K.faint, borderColor: K.line }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rankingVisible.map((r) => (
                      <tr
                        key={r.model_slug}
                        style={{
                          background: r.our_tiers.length ? "#FBFAFF" : undefined
                        }}
                      >
                        <td
                          className="w-[26px] border-b px-2.5 py-2.5 text-[11px]"
                          style={{ color: K.faint, borderColor: K.line2 }}
                        >
                          {r.rank}
                        </td>
                        <td
                          className="border-b px-2.5 py-2.5 text-[12.5px]"
                          style={{ borderColor: K.line2 }}
                        >
                          <Brand brand={r.brand} />{" "}
                          {r.model_slug.split("/").pop()}
                          {r.our_tiers.map((t) => (
                            <span
                              key={t}
                              className="ml-1 rounded-lg px-1.5 py-px text-[9.5px] text-white"
                              style={{ background: K.luna }}
                            >
                              {t}
                            </span>
                          ))}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.intelligence_index ?? "—"}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.multilingual_index ?? "—"}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.agentic_index ?? "—"}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {fmtWon(r.cost_krw)}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px] font-semibold" style={{ borderColor: K.line2 }}>
                          {r.value || "—"}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[10.5px]" style={{ borderColor: K.line2, color: K.faint }}>
                          —
                        </td>
                      </tr>
                    ))}
                    {rankingRest > 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="cursor-pointer px-2.5 py-2 text-center text-[11.5px]"
                          style={{ color: K.faint }}
                          onClick={() => setRankOpen((v) => !v)}
                        >
                          {rankOpen
                            ? "접기"
                            : `외 ${rankingRest}개 · 모두 보기`}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* 4. 가격 추이 */}
          <section>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h3 className="text-[14px] font-bold">가격 추이</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                우리가 쓰는 모델 · 최근 12주
              </span>
            </div>
            <div
              className="rounded-xl border px-[18px] py-4"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {data.history.length === 0 ? (
                <p className="py-8 text-center text-[13px]" style={{ color: K.sub }}>
                  {data.market.error
                    ? data.market.error
                    : data.market.missing_key
                      ? "Artificial Analysis API 키가 필요합니다"
                      : "주간 스냅샷이 아직 없습니다"}
                </p>
              ) : (
                <>
                  <PriceSparkline history={data.history} />
                  <p
                    className="mt-2.5 text-center text-[11.5px]"
                    style={{ color: K.sub }}
                  >
                    {(data.history_weeks ?? 1) < 2
                      ? "주간 스냅샷이 쌓이면 추이가 보입니다 (현재 1주치)"
                      : `현재 ${data.history_weeks}주치 스냅샷`}
                  </p>
                </>
              )}
              {data.price_note ? (
                <p
                  className="mt-2.5 text-center text-[11.5px]"
                  style={{ color: K.sub }}
                >
                  {data.price_note}
                </p>
              ) : null}
            </div>
          </section>

          {/* 5. 우리 사용량 */}
          <section>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
              <h3 className="text-[14px] font-bold">우리 사용량</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                기능별
              </span>
              <span className="ml-auto flex gap-2 text-[11.5px]">
                {(
                  [
                    ["7", "7일"],
                    ["30", "30일"],
                    ["all", "전체"]
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className="cursor-pointer"
                    style={{
                      color: range === k ? K.ink : K.faint,
                      fontWeight: range === k ? 700 : 400
                    }}
                    onClick={() => setRange(k)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2.5 min-[901px]:grid-cols-4">
              {[
                {
                  l: "이번 주 비용",
                  v: fmtWon(data.usage.week_cost),
                  sub:
                    data.usage.week_change_pct != null
                      ? `${data.usage.week_change_pct >= 0 ? "▲" : "▼"}${Math.abs(data.usage.week_change_pct)}%`
                      : undefined,
                  up: (data.usage.week_change_pct ?? 0) > 0
                },
                { l: "호출", v: `${data.usage.week_calls}회` },
                { l: "토큰", v: formatTokens(data.usage.week_tokens) },
                { l: "월 예상", v: fmtWon(data.usage.month_estimate) }
              ].map((s) => (
                <div
                  key={s.l}
                  className="rounded-[10px] border px-3.5 py-3"
                  style={{ borderColor: K.line, background: K.panel }}
                >
                  <div className="text-[11.5px]" style={{ color: K.sub }}>
                    {s.l}
                  </div>
                  <div className="mt-0.5 text-[20px] font-bold">
                    {s.v}{" "}
                    {s.sub ? (
                      <small
                        className="text-[11.5px] font-semibold"
                        style={{ color: s.up ? "#A32D2D" : "#0F6E56" }}
                      >
                        {s.sub}
                      </small>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!data.usage.has_feature ? (
              <p className="mb-2 text-[11.5px]" style={{ color: K.faint }}>
                feature 컬럼이 아직 비어 있어 등급 단위로만 표시합니다. 마이그레이션
                후 기능별 집계가 쌓입니다.
              </p>
            ) : null}
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["등급", "기능", "모델", "호출", "토큰", "비용", "비중"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={`border-b px-2.5 py-2 text-[10.5px] font-semibold ${i >= 3 ? "text-right" : "text-left"}`}
                          style={{ color: K.faint, borderColor: K.line }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.usage.by_feature.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-6 text-center text-[12.5px]"
                        style={{ color: K.faint }}
                      >
                        이 기간 사용량 없음
                      </td>
                    </tr>
                  ) : (
                    data.usage.by_feature.map((r) => (
                      <tr key={`${r.tier}-${r.feature}-${r.model_id}`}>
                        <td className="border-b px-2.5 py-2.5" style={{ borderColor: K.line2 }}>
                          <TierBadge tier={r.tier} size={20} />
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.feature_label}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.model_id}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {r.calls}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {formatTokens(r.tokens)}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right text-[12.5px]" style={{ borderColor: K.line2 }}>
                          {fmtWon(r.cost)}
                        </td>
                        <td className="border-b px-2.5 py-2.5 text-right" style={{ borderColor: K.line2 }}>
                          <div
                            className="ml-auto h-[7px] w-[88px] overflow-hidden rounded"
                            style={{ background: K.chip }}
                          >
                            <i
                              className="block h-full"
                              style={{
                                width: `${Math.min(100, r.share)}%`,
                                background:
                                  TIER_STYLE[r.tier]?.color ?? K.luna
                              }}
                            />
                          </div>
                          <span className="text-[10.5px]" style={{ color: K.faint }}>
                            {r.share}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {data.usage.pricing_source === "official" ? (
              <p className="mt-2 text-[11.5px]" style={{ color: K.faint }}>
                공식 단가 기준
              </p>
            ) : null}
          </section>

          {/* 6. 모드 이력 */}
          <section>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h3 className="text-[14px] font-bold">모드 이력</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                기간별 비용·시험·피드백으로 적정선을 비교합니다
              </span>
            </div>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {(data.mode_history ?? []).length === 0 ? (
                <p
                  className="px-4 py-6 text-center text-[12.5px]"
                  style={{ color: K.faint }}
                >
                  모드를 적용하면 이력이 쌓입니다
                </p>
              ) : (
                (data.mode_history ?? []).map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-[18px] py-3 last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <span
                      className="w-[110px] shrink-0 text-[11.5px]"
                      style={{ color: K.faint }}
                    >
                      {shortDate(m.started_at)}~
                      {m.ended_at ? shortDate(m.ended_at) : "현재"}
                    </span>
                    <span className="w-[72px] text-[13px] font-semibold">
                      {m.mode_label}
                    </span>
                    <span className="text-[12.5px]">
                      월 {fmtWon(m.est_monthly_krw)}
                    </span>
                    <span className="text-[12.5px]" style={{ color: K.sub }}>
                      시험 {m.exam_score ?? "—"}
                    </span>
                    <span className="text-[12.5px]" style={{ color: K.sub }}>
                      👍 {m.thumbs_up} / 👎 {m.thumbs_down}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 7. 교체 이력 */}
          <section>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h3 className="text-[14px] font-bold">교체 이력</h3>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                자동 교체 후 회귀 시험으로 계속 지켜봅니다
              </span>
            </div>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {data.changes.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12.5px]" style={{ color: K.faint }}>
                  교체 이력이 없습니다
                </p>
              ) : (
                data.changes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2.5 border-b px-[18px] py-3 last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <div
                      className="w-[52px] shrink-0 pt-0.5 text-[11px]"
                      style={{ color: K.faint }}
                    >
                      {shortDate(c.created_at)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">
                        <TierBadge tier={c.tier} size={18} />{" "}
                        <b className="font-semibold">
                          {c.from_model_label || "—"} → {c.to_model_label}
                        </b>
                        {c.reverted ? (
                          <span className="text-[12px]" style={{ color: K.sub }}>
                            {" "}
                            · 되돌림
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="mt-0.5 text-[11.5px]"
                        style={{ color: K.sub }}
                      >
                        {c.reason}
                        {c.savings_krw_month != null
                          ? ` · 월 ${fmtWon(c.savings_krw_month)} 절감 예상`
                          : ""}
                      </div>
                    </div>
                    <ExamBadge
                      result={c.exam_result}
                      note={c.exam_note}
                      reverted={c.reverted}
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 7. 설정 */}
          <section>
            <div className="mb-2.5">
              <h3 className="text-[14px] font-bold">설정</h3>
            </div>
            <div
              className="rounded-xl border px-[18px] py-4"
              style={{ borderColor: K.line, background: K.panel }}
            >
              {settings && alerts ? (
                <>
                  <div
                    className="mb-3.5 space-y-1 text-[12.5px] leading-[2.1]"
                  >
                    {(
                      [
                        [
                          "auto_swap",
                          "주 1회 자동 점검 후 등급별 모델을 자동 교체하고 리포트로 알림"
                        ],
                        [
                          "revert_on_drop",
                          "교체 후 회귀 시험 점수가 떨어지면 되돌림 제안"
                        ],
                        [
                          "protect_s",
                          "S 등급은 자동 교체하지 않음 (비용보다 정확성 우선)"
                        ]
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2.5"
                      >
                        <input
                          type="checkbox"
                          className="h-[15px] w-[15px]"
                          checked={settings[key]}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              [key]: e.target.checked
                            })
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-3">
                    <label className="block">
                      <span
                        className="mb-1 block text-[11.5px]"
                        style={{ color: K.sub }}
                      >
                        일 한도 (원)
                      </span>
                      <FieldInput
                        className="w-full"
                        type="number"
                        value={alerts.daily_limit}
                        onChange={(e) =>
                          setAlerts({
                            ...alerts,
                            daily_limit: Number(e.target.value) || 0
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[11.5px]"
                        style={{ color: K.sub }}
                      >
                        월 한도 (원)
                      </span>
                      <FieldInput
                        className="w-full"
                        type="number"
                        value={alerts.monthly_limit}
                        onChange={(e) =>
                          setAlerts({
                            ...alerts,
                            monthly_limit: Number(e.target.value) || 0
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[11.5px]"
                        style={{ color: K.sub }}
                      >
                        급증 기준 (전일 대비 %)
                      </span>
                      <FieldInput
                        className="w-full"
                        type="number"
                        value={alerts.spike_percent}
                        onChange={(e) =>
                          setAlerts({
                            ...alerts,
                            spike_percent: Number(e.target.value) || 0
                          })
                        }
                      />
                    </label>
                  </div>
                  <BtnRow>
                    <Btn primary disabled={busy} onClick={() => void saveSettings()}>
                      저장
                    </Btn>
                    <span className="text-[11.5px]" style={{ color: K.faint }}>
                      한도를 넘으면 알림만 보냅니다. 서비스는 중단되지 않아요
                    </span>
                  </BtnRow>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </KnowledgeShell>
  );
}

function ExamBadge({
  result,
  note,
  reverted
}: {
  result: string | null;
  note: string | null;
  reverted: boolean;
}) {
  let label = "대기";
  let bg = "#FAEEDA";
  let color = "#633806";
  if (reverted || result === "down" || result === "revert") {
    label = note || "시험 하락·되돌림";
    bg = "#FCEBEB";
    color = "#A32D2D";
  } else if (result === "up") {
    label = note || "시험 상승";
    bg = "#E1F5EE";
    color = "#0F6E56";
  } else if (result === "keep") {
    label = note || "시험 유지";
    bg = "#E1F5EE";
    color = "#0F6E56";
  } else if (result === "pending") {
    label = "시험 대기";
  }
  return (
    <span
      className="shrink-0 rounded-[10px] px-[7px] py-px text-[10.5px]"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function PriceSparkline({
  history
}: {
  history: Array<{
    model_slug: string;
    brand: string;
    cost_krw: number | null;
    fetched_at: string;
  }>;
}) {
  const bySlug = new Map<string, Array<{ t: number; c: number }>>();
  for (const h of history) {
    if (h.cost_krw == null) continue;
    const arr = bySlug.get(h.model_slug) ?? [];
    arr.push({ t: new Date(h.fetched_at).getTime(), c: h.cost_krw });
    bySlug.set(h.model_slug, arr);
  }
  const colors = ["#C96442", "#0F9D77", "#3B6396", "#534AB7"];
  const entries = Array.from(bySlug.entries()).slice(0, 4);
  const allCosts = entries.flatMap(([, pts]) => pts.map((p) => p.c));
  const maxC = Math.max(...allCosts, 1);

  return (
    <div>
      <div
        className="relative ml-11 h-[130px] border-b border-l"
        style={{ borderColor: K.line }}
      >
        <svg
          viewBox="0 0 400 130"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {entries.map(([slug, pts], i) => {
            if (pts.length === 0) return null;
            const minT = pts[0]!.t;
            const maxT =
              pts.length >= 2
                ? pts[pts.length - 1]!.t
                : minT + 7 * 24 * 60 * 60 * 1000;
            if (pts.length === 1) {
              const p = pts[0]!;
              const x = 200;
              const y = 130 - (p.c / maxC) * 120;
              return (
                <circle
                  key={slug}
                  cx={x}
                  cy={y}
                  r={4}
                  fill={colors[i % colors.length]}
                />
              );
            }
            const points = pts
              .map((p) => {
                const x = ((p.t - minT) / Math.max(maxT - minT, 1)) * 400;
                const y = 130 - (p.c / maxC) * 120;
                return `${x},${y}`;
              })
              .join(" ");
            return (
              <polyline
                key={slug}
                points={points}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="1.6"
              />
            );
          })}
        </svg>
      </div>
      <div
        className="mt-[22px] flex flex-wrap justify-center gap-4 text-[11px]"
        style={{ color: K.sub }}
      >
        {entries.map(([slug], i) => (
          <span key={slug} style={{ color: colors[i % colors.length] }}>
            — {slug.split("/").pop()}
          </span>
        ))}
      </div>
    </div>
  );
}
