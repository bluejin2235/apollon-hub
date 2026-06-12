"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ApiUsageDbRow } from "@/lib/arte/api-usage";
import { formatKrw, useUsdKrwForUsage } from "@/lib/arte/usd-krw-rate";
import { supabase } from "@/lib/supabase/client";

type PeriodPreset = "last_30days" | "this_month" | "last_month" | "last_3m" | "custom";

type CreditRecordRow = {
  id: string;
  service_name: string;
  payment_type: string;
  amount_krw: number;
  paid_at: string;
  registered_by: string | null;
  registrar_name?: string | null;
};

type Props = {
  onTabChange: (tab: "usage" | "credits") => void;
};

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "last_30days", label: "최근 1달" },
  { value: "this_month", label: "이번 달" },
  { value: "last_month", label: "지난 달" },
  { value: "last_3m", label: "최근 3개월" },
  { value: "custom", label: "직접 선택" }
];

function resolveDateRange(preset: PeriodPreset, customStart: string, customEnd: string) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (preset === "last_30days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    return { start: fmt(start), end: fmt(today) };
  }
  if (preset === "this_month") {
    return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) };
  }
  if (preset === "last_month") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: fmt(first), end: fmt(last) };
  }
  if (preset === "last_3m") {
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    return { start: fmt(start), end: fmt(today) };
  }
  return { start: customStart, end: customEnd };
}

function getMonthKeysInRange(start: string, end: string): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    keys.push({ key, label: `${m}월` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

function monthKeyFromDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function paymentTypeLabel(t: string) {
  if (t === "크레딧") return { text: "크레딧", bg: "bg-emerald-50", color: "text-emerald-700" };
  if (t === "초과결제") return { text: "초과", bg: "bg-amber-50", color: "text-amber-700" };
  return { text: t, bg: "bg-slate-100", color: "text-slate-600" };
}

export function AiCostOverview({ onTabChange }: Props) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<PeriodPreset>("last_30days");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(todayIso);

  const [apiRows, setApiRows] = useState<ApiUsageDbRow[]>([]);
  const [creditRows, setCreditRows] = useState<CreditRecordRow[]>([]);
  const [teamCount, setTeamCount] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { usdKrw, monthLabel } = useUsdKrwForUsage();
  const range = useMemo(
    () => resolveDateRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );
  const chartMonths = useMemo(
    () => getMonthKeysInRange(range.start, range.end),
    [range.start, range.end]
  );

  const load = useCallback(async () => {
    setLoading(true);

    const [
      { data: userData },
      teamRes,
      apiRes,
      creditRes
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "근무"),
      supabase
        .from("api_usage")
        .select("*")
        .gte("date", range.start)
        .lte("date", range.end)
        .order("date", { ascending: true }),
      supabase
        .from("credit_records")
        .select("id, service_name, payment_type, amount_krw, paid_at, registered_by, registrar:profiles!registered_by(name)")
        .gte("paid_at", range.start)
        .lte("paid_at", range.end)
        .order("paid_at", { ascending: false })
    ]);

    setUserId(userData.user?.id ?? null);
    setTeamCount(Math.max(teamRes.count ?? 1, 1));

    if (apiRes.error) console.error("[ai-cost-overview] api_usage", apiRes.error);
    if (creditRes.error) console.error("[ai-cost-overview] credit_records", creditRes.error);

    setApiRows((apiRes.data ?? []) as ApiUsageDbRow[]);
    setCreditRows(
      (creditRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        service_name: String(r.service_name ?? ""),
        payment_type: String(r.payment_type ?? ""),
        amount_krw: Number(r.amount_krw ?? 0),
        paid_at: String(r.paid_at ?? ""),
        registered_by: (r.registered_by as string | null) ?? null,
        registrar_name: (r.registrar as { name?: string } | null)?.name ?? null
      }))
    );
    setLoading(false);
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodApiRows = apiRows;
  const periodCreditRows = creditRows;

  const apiCostUsd = periodApiRows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const apiCostKrw = apiCostUsd * usdKrw;
  const apiRequests = periodApiRows.reduce((s, r) => s + (r.num_requests ?? 0), 0);
  const creditCostKrw = periodCreditRows.reduce((s, r) => s + r.amount_krw, 0);
  const totalCostKrw = apiCostKrw + creditCostKrw;

  const myApiUsd = userId
    ? periodApiRows.filter((r) => r.uploaded_by === userId).reduce((s, r) => s + Number(r.cost_usd), 0)
    : 0;
  const myCreditKrw = userId
    ? periodCreditRows.filter((r) => r.registered_by === userId).reduce((s, r) => s + r.amount_krw, 0)
    : 0;
  const myCostKrw = myApiUsd * usdKrw + myCreditKrw;
  const teamAvgKrw = totalCostKrw / teamCount;

  const providerStats = useMemo(() => {
    const providers = ["anthropic", "openai"] as const;
    return providers.map((provider) => {
      const rows = periodApiRows.filter((r) => r.provider === provider);
      const costUsd = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
      const requests = rows.reduce((s, r) => s + (r.num_requests ?? 0), 0);
      return {
        provider,
        label: provider === "anthropic" ? "Anthropic" : "OpenAI",
        costKrw: costUsd * usdKrw,
        requests,
        avgKrw: requests > 0 ? (costUsd * usdKrw) / requests : 0
      };
    });
  }, [periodApiRows, usdKrw]);

  const maxProviderCost = Math.max(...providerStats.map((p) => p.costKrw), 1);

  const monthlyChartData = useMemo(() => {
    const chartKeys = new Set(chartMonths.map((m) => m.key));
    const apiByMonth = new Map<string, number>();
    const creditByMonth = new Map<string, number>();

    for (const r of periodApiRows) {
      const key = monthKeyFromDate(r.date);
      if (!chartKeys.has(key)) continue;
      apiByMonth.set(key, (apiByMonth.get(key) ?? 0) + Number(r.cost_usd) * usdKrw);
    }
    for (const r of periodCreditRows) {
      const key = monthKeyFromDate(r.paid_at);
      if (!chartKeys.has(key)) continue;
      creditByMonth.set(key, (creditByMonth.get(key) ?? 0) + r.amount_krw);
    }

    return chartMonths.map((m) => ({
      label: m.label,
      apiKrw: Math.round(apiByMonth.get(m.key) ?? 0),
      creditKrw: Math.round(creditByMonth.get(m.key) ?? 0)
    }));
  }, [periodApiRows, periodCreditRows, chartMonths, usdKrw]);

  const recentCredits = periodCreditRows.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* 기간 필터 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">조회 기간</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPeriod(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                period === opt.value
                  ? "bg-violet-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              시작
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              종료
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={todayIso}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            {range.start} ~ {range.end}
          </p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <>
          {/* KPI 카드 */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">기간 총 AI 비용</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatKrw(totalCostKrw)}</p>
              <p className="mt-1 text-xs text-slate-500">API + 크레딧 합산</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">API 사용 비용</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-violet-700">{formatKrw(apiCostKrw)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {apiRequests.toLocaleString("ko-KR")}회 호출 · 환율 {monthLabel}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">크레딧 충전 비용</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-orange-600">{formatKrw(creditCostKrw)}</p>
              <p className="mt-1 text-xs text-slate-500">{periodCreditRows.length}건 등록</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">내 비용</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatKrw(myCostKrw)}</p>
              <p className="mt-1 text-xs text-slate-500">
                팀 평균 {formatKrw(teamAvgKrw)} ({teamCount}명)
              </p>
            </div>
          </section>

          {/* 월별 비용 추이 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">월별 비용 추이</h2>
            <p className="mt-1 text-xs text-slate-500">{range.start} ~ {range.end} · API(보라) / 크레딧(주황)</p>
            <div className="mt-4 h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      typeof v === "number"
                        ? v >= 1_000_000
                          ? `₩${(v / 1_000_000).toFixed(1)}M`
                          : v >= 1_000
                            ? `₩${(v / 1_000).toFixed(0)}K`
                            : `₩${v}`
                        : String(v)
                    }
                  />
                  <Tooltip
                    formatter={(value, _name, item) => {
                      const dataKey = String(item?.dataKey ?? "");
                      const label = dataKey === "apiKrw" ? "API" : dataKey === "creditKrw" ? "크레딧" : String(_name);
                      return [
                        formatKrw(typeof value === "number" ? value : Number(value)),
                        label
                      ];
                    }}
                  />
                  <Legend />
                  <Bar dataKey="apiKrw" name="API" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="creditKrw" name="크레딧" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* API 사용 비용 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">API 사용 비용</h2>
              <button
                type="button"
                onClick={() => onTabChange("usage")}
                className="text-sm font-medium text-violet-600 hover:text-violet-800"
              >
                상세 보기 →
              </button>
            </div>
            <div className="space-y-4">
              {providerStats.map((p) => (
                <div key={p.provider}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{p.label}</span>
                    <span className="tabular-nums text-slate-600">
                      {formatKrw(p.costKrw)} · {p.requests.toLocaleString("ko-KR")}회 · 호출당{" "}
                      {p.requests > 0 ? formatKrw(p.avgKrw) : "—"}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${p.provider === "anthropic" ? "bg-violet-500" : "bg-emerald-500"}`}
                      style={{ width: `${(p.costKrw / maxProviderCost) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {providerStats.every((p) => p.costKrw === 0) && (
                <p className="text-sm text-slate-500">해당 기간 API 사용 데이터가 없습니다.</p>
              )}
            </div>
          </section>

          {/* 크레딧 · 추가 결제 */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">크레딧 · 추가 결제</h2>
              <button
                type="button"
                onClick={() => onTabChange("credits")}
                className="text-sm font-medium text-violet-600 hover:text-violet-800"
              >
                상세 보기 →
              </button>
            </div>
            {recentCredits.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">해당 기간 등록 내역이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">서비스</th>
                    <th className="px-5 py-3">유형</th>
                    <th className="px-5 py-3">날짜</th>
                    <th className="px-5 py-3">등록자</th>
                    <th className="px-5 py-3 text-right">금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentCredits.map((r) => {
                    const tag = paymentTypeLabel(r.payment_type);
                    return (
                      <tr key={r.id}>
                        <td className="px-5 py-3 font-medium text-slate-900">{r.service_name}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag.bg} ${tag.color}`}>
                            {tag.text}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{r.paid_at}</td>
                        <td className="px-5 py-3 text-slate-600">{r.registrar_name ?? "—"}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">
                          {r.amount_krw.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
