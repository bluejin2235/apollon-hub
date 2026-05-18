"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatCurrency } from "@/lib/licenses/calc";
import {
  buildMonthRows,
  canCompareMonthOverMonth,
  clampCostRangeStart,
  COST_ANALYTICS_MIN_MONTH,
  COST_METRIC_LABELS,
  currentYearMonth,
  listMonthsInRange,
  pctChange,
  shiftMonth,
  type CostContractFilter,
  type CostMetricKey
} from "@/lib/licenses/cost-analytics";
import type { License, Profile } from "@/lib/licenses/types";
import { useKrwRates } from "@/lib/licenses/use-krw-rates";
import { supabase } from "@/lib/supabase/client";

type PeriodPreset = "3m" | "6m" | "1y" | "custom";
type ChartMode = "line" | "area";

const CONTRACT_OPTIONS: { value: CostContractFilter; label: string }[] = [
  { value: "전체", label: "전체" },
  { value: "월 구독", label: "월 구독" },
  { value: "년 구독", label: "년 구독" },
  { value: "영구 라이선스", label: "영구 라이선스" }
];

const METRIC_OPTIONS: CostMetricKey[] = [
  "subscription",
  "perpetual",
  "members",
  "perMember",
  "byCategory"
];

const METRIC_COLORS: Record<"subscription" | "perpetual" | "perMember" | "members", string> = {
  subscription: "#7c3aed",
  perpetual: "#64748b",
  perMember: "#0ea5e9",
  members: "#10b981"
};

const CATEGORY_COLORS = ["#3b82f6", "#a855f7", "#f97316", "#14b8a6", "#ec4899"];

function formatPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** 차트 툴팁 금액: 만원 단위 반올림 */
function formatTooltipWon(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0만원";
  if (value < 10_000) return "1만원 미만";
  return `${Math.round(value / 10_000)}만원`;
}

function tooltipSeriesLabel(dataKey: string): string {
  if (dataKey === "members") return COST_METRIC_LABELS.members;
  if (dataKey === "subscription") return COST_METRIC_LABELS.subscription;
  if (dataKey === "perpetual") return COST_METRIC_LABELS.perpetual;
  if (dataKey === "perMember") return COST_METRIC_LABELS.perMember;
  if (dataKey.startsWith("cat_")) return dataKey.slice(4);
  return dataKey;
}

function formatTooltipValue(dataKey: string, value: number): string {
  if (dataKey === "members") return `${Math.round(value)}명`;
  return formatTooltipWon(value);
}

type CostChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{
    value?: number | string;
    color?: string;
    dataKey?: string | number;
  }>;
};

function CostChartTooltip({ active, label, payload }: CostChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const rows = [...payload]
    .map((entry) => {
      const dataKey = String(entry.dataKey ?? "");
      const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
      return { dataKey, value, color: entry.color ?? "#64748b" };
    })
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-md">
      {label != null && label !== "" ? (
        <p className="mb-1.5 text-[11px] font-semibold text-slate-800">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="truncate text-[11px] text-slate-600">{tooltipSeriesLabel(row.dataKey)}</span>
            </span>
            <span className="shrink-0 text-[12px] font-medium tabular-nums text-slate-900">
              {formatTooltipValue(row.dataKey, row.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LicensesCostsPage() {
  const rates = useKrwRates();
  const currentYm = currentYearMonth();

  const [services, setServices] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<PeriodPreset>("6m");
  const [customStart, setCustomStart] = useState(
    clampCostRangeStart(shiftMonth(currentYm, -5))
  );
  const [customEnd, setCustomEnd] = useState(currentYm);
  const [category, setCategory] = useState("전체");
  const [serviceId, setServiceId] = useState("전체");
  const [contractType, setContractType] = useState<CostContractFilter>("전체");
  const [metrics, setMetrics] = useState<CostMetricKey[]>(["subscription", "perMember"]);
  const [chartMode, setChartMode] = useState<ChartMode>("line");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const [sRes, pRes] = await Promise.all([
        supabase.from("services").select("*").eq("is_hub_card", false).order("name"),
        supabase
          .from("profiles")
          .select("id, email, name, department, role, status, created_at")
      ]);
      setServices((sRes.data ?? []) as License[]);
      setProfiles((pRes.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, [period, customStart, customEnd, currentYm]);

  const range = useMemo(() => {
    const endYm = period === "custom" ? customEnd : currentYm;
    const rawStartYm =
      period === "custom"
        ? customStart
        : period === "3m"
          ? shiftMonth(endYm, -2)
          : period === "1y"
            ? shiftMonth(endYm, -11)
            : shiftMonth(endYm, -5);
    const startYm = clampCostRangeStart(rawStartYm);
    const safeEndYm = endYm < startYm ? startYm : endYm;
    return { startYm, endYm: safeEndYm, months: listMonthsInRange(startYm, safeEndYm) };
  }, [period, customStart, customEnd, currentYm]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) {
      const c = (s.category ?? "").trim();
      if (c) set.add(c);
    }
    return ["전체", ...Array.from(set).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [services]);

  const serviceOptions = useMemo(
    () =>
      [...services]
        .filter((s) => s.status === "활성")
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [services]
  );

  const filters = useMemo(
    () => ({ category, serviceId, contractType }),
    [category, serviceId, contractType]
  );

  const monthRows = useMemo(
    () =>
      buildMonthRows({
        months: range.months,
        currentYm,
        services,
        profiles,
        rates,
        filters
      }),
    [range.months, currentYm, services, profiles, rates, filters]
  );

  const summary = useMemo(() => {
    const n = monthRows.length || 1;
    const subTotal = monthRows.reduce((s, r) => s + r.subscriptionKrw, 0);
    const perpTotal = monthRows.reduce((s, r) => s + r.perpetualKrw, 0);
    const avgSub = subTotal / n;
    const avgMembers = monthRows.reduce((s, r) => s + r.memberCount, 0) / n;
    return { subTotal, perpTotal, avgSub, avgMembers };
  }, [monthRows]);

  const topCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of monthRows) {
      for (const [cat, v] of Object.entries(row.byCategory)) {
        totals.set(cat, (totals.get(cat) ?? 0) + v.subscriptionKrw);
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }, [monthRows]);

  const chartData = useMemo(() => {
    return monthRows.map((row) => {
      const base: Record<string, string | number | boolean> = {
        month: row.month,
        label: row.label,
        isCurrent: row.isCurrent,
        subscription: row.subscriptionKrw,
        perpetual: row.perpetualKrw,
        members: row.memberCount,
        perMember: Math.round(row.perMemberKrw)
      };
      for (const cat of topCategories) {
        base[`cat_${cat}`] = row.byCategory[cat]?.subscriptionKrw ?? 0;
      }
      return base;
    });
  }, [monthRows, topCategories]);

  const toggleMetric = (key: CostMetricKey) => {
    setMetrics((prev) =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]
    );
  };

  const chartAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
      <YAxis
        yAxisId="krw"
        tick={{ fontSize: 11 }}
        tickFormatter={(v) => (typeof v === "number" ? `${Math.round(v / 10000)}만` : String(v))}
      />
      <YAxis
        yAxisId="perp"
        orientation="right"
        hide={!metrics.includes("perpetual")}
        tick={{ fontSize: 11 }}
        tickFormatter={(v) => (typeof v === "number" ? `${Math.round(v / 10000)}만` : String(v))}
      />
      <YAxis
        yAxisId="count"
        orientation="right"
        hide={!metrics.includes("members") || metrics.includes("perpetual")}
        tick={{ fontSize: 11 }}
      />
      <Tooltip content={<CostChartTooltip />} />
      <Legend />
    </>
  );

  const chartSeries =
    chartMode === "line" ? (
      <>
        {metrics.includes("subscription") ? (
          <Line
            yAxisId="krw"
            type="monotone"
            dataKey="subscription"
            name={COST_METRIC_LABELS.subscription}
            stroke={METRIC_COLORS.subscription}
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props as {
                cx: number;
                cy: number;
                payload?: { isCurrent?: boolean };
              };
              const cur = payload?.isCurrent;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={cur ? 6 : 4}
                  fill={cur ? "#fff" : METRIC_COLORS.subscription}
                  stroke={METRIC_COLORS.subscription}
                  strokeWidth={cur ? 3 : 1}
                />
              );
            }}
          />
        ) : null}
        {metrics.includes("perpetual") ? (
          <Line
            yAxisId="perp"
            type="monotone"
            dataKey="perpetual"
            name={COST_METRIC_LABELS.perpetual}
            stroke={METRIC_COLORS.perpetual}
            strokeWidth={2}
            dot={{ r: 4, fill: METRIC_COLORS.perpetual, strokeWidth: 0 }}
            connectNulls={false}
          />
        ) : null}
        {metrics.includes("perMember") ? (
          <Line
            yAxisId="krw"
            type="monotone"
            dataKey="perMember"
            name={COST_METRIC_LABELS.perMember}
            stroke={METRIC_COLORS.perMember}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 4, fill: METRIC_COLORS.perMember, strokeWidth: 0 }}
          />
        ) : null}
        {metrics.includes("members") ? (
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="members"
            name={COST_METRIC_LABELS.members}
            stroke={METRIC_COLORS.members}
            strokeWidth={2}
            dot={{ r: 4, fill: METRIC_COLORS.members, strokeWidth: 0 }}
          />
        ) : null}
        {metrics.includes("byCategory")
          ? topCategories.map((cat, i) => {
              const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
              return (
                <Line
                  key={cat}
                  yAxisId="krw"
                  type="monotone"
                  dataKey={`cat_${cat}`}
                  name={cat}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                />
              );
            })
          : null}
      </>
    ) : (
      <>
        {metrics.includes("subscription") ? (
          <Area
            yAxisId="krw"
            type="monotone"
            dataKey="subscription"
            name={COST_METRIC_LABELS.subscription}
            stroke={METRIC_COLORS.subscription}
            fill={METRIC_COLORS.subscription}
            fillOpacity={0.3}
            strokeWidth={2}
          />
        ) : null}
        {metrics.includes("perpetual") ? (
          <Area
            yAxisId="perp"
            type="monotone"
            dataKey="perpetual"
            name={COST_METRIC_LABELS.perpetual}
            stroke={METRIC_COLORS.perpetual}
            fill={METRIC_COLORS.perpetual}
            fillOpacity={0.3}
            strokeWidth={2}
            connectNulls={false}
          />
        ) : null}
        {metrics.includes("perMember") ? (
          <Area
            yAxisId="krw"
            type="monotone"
            dataKey="perMember"
            name={COST_METRIC_LABELS.perMember}
            stroke={METRIC_COLORS.perMember}
            fill={METRIC_COLORS.perMember}
            fillOpacity={0.3}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        ) : null}
        {metrics.includes("members") ? (
          <Area
            yAxisId="count"
            type="monotone"
            dataKey="members"
            name={COST_METRIC_LABELS.members}
            stroke={METRIC_COLORS.members}
            fill={METRIC_COLORS.members}
            fillOpacity={0.3}
            strokeWidth={2}
          />
        ) : null}
        {metrics.includes("byCategory")
          ? topCategories.map((cat, i) => {
              const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
              return (
                <Area
                  key={cat}
                  yAxisId="krw"
                  type="monotone"
                  dataKey={`cat_${cat}`}
                  name={cat}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.3}
                  strokeWidth={1.5}
                />
              );
            })
          : null}
      </>
    );

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">비용 현황</h1>
        <p className="mt-1 text-sm text-slate-600">
          월별 구독·영구 비용 추이와 팀 단위 비용을 확인합니다. ({COST_ANALYTICS_MIN_MONTH} 이후 데이터만 표시)
        </p>
      </header>

      {/* ① 조회 조건 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">조회 조건</h2>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">기간</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["3m", "3개월"],
                  ["6m", "6개월"],
                  ["1y", "1년"],
                  ["custom", "직접입력"]
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    period === key
                      ? "bg-violet-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  시작
                  <input
                    type="month"
                    min={COST_ANALYTICS_MIN_MONTH}
                    value={customStart}
                    onChange={(e) => setCustomStart(clampCostRangeStart(e.target.value))}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  종료
                  <input
                    type="month"
                    min={COST_ANALYTICS_MIN_MONTH}
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">조직/카테고리</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">라이선스</span>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="전체">전체</option>
                {serviceOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">계약유형</span>
              <select
                value={contractType}
                onChange={(e) => setContractType(e.target.value as CostContractFilter)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {CONTRACT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">지표 선택 (복수)</p>
            <div className="flex flex-wrap gap-2">
              {METRIC_OPTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleMetric(key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    metrics.includes(key)
                      ? "bg-violet-100 text-violet-800 ring-1 ring-violet-300"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {COST_METRIC_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ② 요약 4카드 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">기간 구독 총비용</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {formatCurrency(summary.subTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">기간 영구구매 합계</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {formatCurrency(summary.perpTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">월 평균 비용</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-violet-700">
            {formatCurrency(summary.avgSub)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">구독 월 환산 기준</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">평균 팀원 수</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {Math.round(summary.avgMembers)}명
          </p>
        </div>
      </section>

      {/* ③ 차트 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">월별 추이</h2>
          <div className="flex gap-2">
            {(
              [
                ["line", "꺾은선"],
                ["area", "누적"]
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChartMode(mode)}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${
                  chartMode === mode
                    ? "bg-slate-800 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[360px] w-full">
          {chartData.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">
              표시할 데이터가 없습니다.
            </p>
          ) : chartMode === "line" ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                {chartAxes}
                {chartSeries}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                {chartAxes}
                {chartSeries}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          구독(좌측 축)과 영구구매(우측 축)는 별도 스케일입니다. 영구구매는 구매 발생 월에만 표시됩니다. 현재월
          구독 꺾은선 포인트는 진한 테두리로 강조됩니다.
        </p>
      </section>

      {/* ④ 테이블 */}
      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
              <th className="px-4 py-3">월</th>
              <th className="px-4 py-3 text-right">월 구독 합계</th>
              <th className="px-4 py-3 text-right">영구구매</th>
              <th className="px-4 py-3 text-right">팀원 수</th>
              <th className="px-4 py-3 text-right">1인당 비용</th>
              <th className="px-4 py-3 text-right">전월 대비</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {monthRows.map((row, idx) => {
              const prev = idx > 0 ? monthRows[idx - 1] : null;
              const comparable = canCompareMonthOverMonth(idx);
              const change = comparable
                ? pctChange(row.subscriptionKrw, prev?.subscriptionKrw ?? null)
                : null;
              return (
                <tr
                  key={row.month}
                  className={row.isCurrent ? "bg-violet-50/60 font-medium" : "text-slate-800"}
                >
                  <td className="px-4 py-3">
                    {row.label}
                    {row.isCurrent ? (
                      <span className="ml-2 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                        현재
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(row.subscriptionKrw)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.perpetualKrw > 0 ? formatCurrency(row.perpetualKrw) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.memberCount}명</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(row.perMemberKrw)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      comparable && change != null && change > 0
                        ? "text-rose-600"
                        : comparable && change != null && change < 0
                          ? "text-emerald-600"
                          : "text-slate-500"
                    }`}
                  >
                    {comparable ? formatPct(change) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
