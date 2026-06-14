"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Legend, Pie, PieChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  activeProfiles,
  computeLicenseCostBreakdown,
  computeLicenseNextRenewal,
  formatCurrency,
  formatDateKorean,
  resolveUiContractType
} from "@/lib/licenses/calc";
import { getCategoryColorHex } from "@/lib/licenses/category-colors";
import type { License, Profile } from "@/lib/licenses/types";
import { useKrwRates } from "@/lib/licenses/use-krw-rates";
import { supabase } from "@/lib/supabase/client";

function isActiveService(l: License): boolean {
  return l.status === "활성";
}

function monthlyKrwForDashboard(
  b: ReturnType<typeof computeLicenseCostBreakdown>
): number {
  if (b.monthlyTotalKrw != null) return b.monthlyTotalKrw;
  if (b.isKrw && !b.isPerpetual) return b.monthlyTotalOrig;
  return 0;
}

function annualSubscriptionKrwForDashboard(
  b: ReturnType<typeof computeLicenseCostBreakdown>
): number {
  if (b.isPerpetual) return 0;
  if (b.annualTotalKrw != null) return b.annualTotalKrw;
  if (b.isKrw) return b.annualTotalOrig;
  return 0;
}

function perpetualTotalKrwForDashboard(
  b: ReturnType<typeof computeLicenseCostBreakdown>
): number {
  if (!b.isPerpetual) return 0;
  if (b.perpetualTotalKrw != null) return b.perpetualTotalKrw;
  if (b.isKrw) return b.perpetualTotalOrig;
  return 0;
}

type CategoryRow = {
  key: string;
  serviceCount: number;
  subscriptionMonthlyKrw: number;
  perpetualKrw: number;
  color: string;
};

type LicensePeriodPreset = "last_3m" | "last_6m" | "last_1y" | "custom";

type CostHistoryRow = {
  service_id: string;
  cost_monthly: number;
  cost_monthly_krw: number | null;
  currency: string;
  contract_type: string | null;
  active_member_count: number | null;
  category: string | null;
  recorded_at: string;
  recorded_month: string;
};

type MonthlyTrendPoint = {
  monthKey: string;
  label: string;
  subscriptionTotal: number;
  perPersonCost: number;
  memberCount: number;
  byCategory: Record<string, number>;
};

const CATEGORY_COLORS: Record<string, string> = {
  "전사/공통": "#7F77DD",
  "디자인/공통": "#A07178",
  "디자인/비주얼": "#EF9F27",
  "디자인/공간": "#1D9E75",
  "기획/공통": "#534AB7",
  "기획/공간": "#D4537E",
  "공통": "#888780",
  "미분류": "#CBD5E1"
};

const PERIOD_OPTIONS: { value: LicensePeriodPreset; label: string }[] = [
  { value: "last_3m", label: "최근 3개월" },
  { value: "last_6m", label: "최근 6개월" },
  { value: "last_1y", label: "최근 1년" },
  { value: "custom", label: "직접 선택" }
];

function resolveLicenseDateRange(
  preset: LicensePeriodPreset,
  customStart: string,
  customEnd: string,
  today = new Date()
): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === "custom") return { start: customStart, end: customEnd };
  if (preset === "last_3m") {
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    return { start: toIso(start), end: toIso(today) };
  }
  if (preset === "last_6m") {
    const start = new Date(today);
    start.setMonth(start.getMonth() - 6);
    return { start: toIso(start), end: toIso(today) };
  }
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  return { start: toIso(start), end: toIso(today) };
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

function CategoryTrendTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-slate-900">{label}</p>
      <div className="mt-1 space-y-0.5">
        {payload
          .filter((entry) => Number(entry.value ?? 0) > 0)
          .map((entry) => (
            <p key={entry.name} className="text-slate-600">
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}: {formatCurrency(Number(entry.value))}
            </p>
          ))}
      </div>
      <p className="mt-1 border-t border-slate-100 pt-1 font-medium text-slate-900">
        합계: {formatCurrency(total)}
      </p>
    </div>
  );
}

function IconSubscriptionPurple({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function IconShieldGray({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      />
    </svg>
  );
}

function IconCubeGreen({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function IconUsersPurple({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function IconCalendarOrange({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function IconEmptyBox({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V7a2 2 0 00-2-2H6L4 7v13a2 2 0 002 2h14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 13h6" />
    </svg>
  );
}

export default function LicensesDashboardPage() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<LicensePeriodPreset>("last_6m");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [costHistory, setCostHistory] = useState<CostHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);
  const rates = useKrwRates();

  const range = useMemo(
    () => resolveLicenseDateRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const run = async () => {
      setLoading(true);
      const [l, p] = await Promise.all([
        supabase
          .from("services")
          .select("*")
          .eq("is_hub_card", false)
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, email, name, department, role, status, created_at")
          .order("created_at", { ascending: true })
      ]);
      setLicenses((l.data ?? []) as License[]);
      setProfiles((p.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, []);

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase
        .from("service_cost_history")
        .select(
          "service_id, cost_monthly, cost_monthly_krw, currency, contract_type, active_member_count, category, recorded_at, recorded_month"
        )
        .gte("recorded_at", `${range.start}T00:00:00+00:00`)
        .lte("recorded_at", `${range.end}T23:59:59+00:00`)
        .order("recorded_at", { ascending: true });

      if (error) {
        console.error("[costHistory] fetch error", error);
        return;
      }
      console.warn("[costHistory] fetched", data?.length, "rows");
      setCostHistory((data ?? []) as CostHistoryRow[]);
    };
    void run();
  }, [range.start, range.end]);

  const teamActive = useMemo(() => activeProfiles(profiles), [profiles]);

  const metrics = useMemo(() => {
    let subscriptionMonthlySum = 0;
    let annualSubscriptionSum = 0;
    let perpetualPurchaseSum = 0;
    let perpetualServiceCount = 0;

    for (const l of licenses) {
      if (!isActiveService(l)) continue;
      const b = computeLicenseCostBreakdown(l, rates);
      if (b.isPerpetual) {
        perpetualPurchaseSum += perpetualTotalKrwForDashboard(b);
        perpetualServiceCount += 1;
      } else {
        subscriptionMonthlySum += monthlyKrwForDashboard(b);
        annualSubscriptionSum += annualSubscriptionKrwForDashboard(b);
      }
    }

    return {
      subscriptionMonthlySum,
      annualSubscriptionSum,
      perpetualPurchaseSum,
      perpetualServiceCount
    };
  }, [licenses, rates]);

  const serviceTotals = useMemo(() => {
    let sub = 0;
    let perp = 0;
    for (const l of licenses) {
      const ui = resolveUiContractType(l);
      if (ui === "영구 라이선스") perp += 1;
      else sub += 1;
    }
    return { total: licenses.length, sub, perp };
  }, [licenses]);

  const { sortedCategoryRows, totalSubscriptionMonthlyForShare } = useMemo(() => {
    const map = new Map<
      string,
      { serviceCount: number; subscriptionMonthlyKrw: number; perpetualKrw: number }
    >();

    for (const l of licenses) {
      const key = (l.category ?? "").trim() || "카테고리 미분류";
      if (!map.has(key)) {
        map.set(key, { serviceCount: 0, subscriptionMonthlyKrw: 0, perpetualKrw: 0 });
      }
      const row = map.get(key)!;
      row.serviceCount += 1;

      if (!isActiveService(l)) continue;

      const b = computeLicenseCostBreakdown(l, rates);
      if (b.isPerpetual) {
        row.perpetualKrw += perpetualTotalKrwForDashboard(b);
      } else {
        row.subscriptionMonthlyKrw += monthlyKrwForDashboard(b);
      }
    }

    const totalSubscriptionMonthlyForShare = [...map.values()].reduce(
      (s, r) => s + r.subscriptionMonthlyKrw,
      0
    );

    const sortedCategoryRows: CategoryRow[] = [...map.entries()]
      .map(([key, v]) => ({
        key,
        serviceCount: v.serviceCount,
        subscriptionMonthlyKrw: v.subscriptionMonthlyKrw,
        perpetualKrw: v.perpetualKrw,
        color: getCategoryColorHex(key)
      }))
      .sort((a, b) => {
        if (b.subscriptionMonthlyKrw !== a.subscriptionMonthlyKrw) {
          return b.subscriptionMonthlyKrw - a.subscriptionMonthlyKrw;
        }
        return a.key.localeCompare(b.key, "ko");
      });

    return { sortedCategoryRows, totalSubscriptionMonthlyForShare };
  }, [licenses, rates]);

  const renewalItems = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const items: { id: string; name: string; date: Date; daysLeft: number }[] = [];

    for (const l of licenses) {
      if (!isActiveService(l)) continue;
      if (resolveUiContractType(l) === "영구 라이선스") continue;
      const d = computeLicenseNextRenewal(l);
      if (!d) continue;
      const daysLeft = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (daysLeft < 0 || daysLeft > 30) continue;
      items.push({ id: l.id, name: l.name, date: d, daysLeft });
    }

    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return items;
  }, [licenses]);

  const chartData = useMemo(() => {
    return sortedCategoryRows
      .filter((r) => r.subscriptionMonthlyKrw > 0)
      .map((r) => ({
        name: r.key,
        value: r.subscriptionMonthlyKrw,
        fill: r.color
      }));
  }, [sortedCategoryRows]);

  const totalPerpetualKrwAcrossCategories = useMemo(
    () => sortedCategoryRows.reduce((s, r) => s + r.perpetualKrw, 0),
    [sortedCategoryRows]
  );

  const totalServicesInCategories = useMemo(
    () => sortedCategoryRows.reduce((s, r) => s + r.serviceCount, 0),
    [sortedCategoryRows]
  );

  const monthlyTrendData = useMemo((): MonthlyTrendPoint[] => {
    const months = getMonthKeysInRange(range.start, range.end);

    // recorded_month별 service_id별 최신 행만 유지
    const byMonth = new Map<string, Map<string, CostHistoryRow>>();
    for (const row of costHistory) {
      if (!byMonth.has(row.recorded_month)) {
        byMonth.set(row.recorded_month, new Map());
      }
      const serviceMap = byMonth.get(row.recorded_month)!;
      const prev = serviceMap.get(row.service_id);
      if (!prev || row.recorded_at > prev.recorded_at) {
        serviceMap.set(row.service_id, row);
      }
    }

    return months.map(({ key, label }) => {
      const serviceMap = byMonth.get(key);
      let subscriptionTotal = 0;
      const memberCounts: number[] = [];
      const byCategory: Record<string, number> = {};

      if (serviceMap) {
        for (const row of serviceMap.values()) {
          if (row.active_member_count != null && row.active_member_count > 0) {
            memberCounts.push(row.active_member_count);
          }
          if (row.contract_type === "영구 라이선스") continue;

          const krw = row.cost_monthly_krw != null
            ? Number(row.cost_monthly_krw)
            : (() => {
                const monthly = Number(row.cost_monthly);
                const cur = (row.currency ?? "KRW").toUpperCase();
                const usdKrw = rates?.USD ?? 1525;
                const eurKrw = rates?.EUR ?? 1690;
                if (cur === "USD") return monthly * usdKrw;
                if (cur === "EUR") return monthly * eurKrw;
                return monthly;
              })();

          const monthlyKrw = row.contract_type === "년 구독"
            ? Math.round(krw / 12)
            : krw;

          subscriptionTotal += monthlyKrw;
          const cat = row.category ?? "미분류";
          byCategory[cat] = (byCategory[cat] ?? 0) + monthlyKrw;
        }
      } // serviceMap 없으면 subscriptionTotal = 0 그대로 유지

      const memberCount = memberCounts.length > 0
        ? Math.round(memberCounts.reduce((s, n) => s + n, 0) / memberCounts.length)
        : (teamActive.length > 0 ? teamActive.length : 12);

      const perPersonCost = memberCount > 0
        ? Math.round(subscriptionTotal / memberCount)
        : 0;

      return { monthKey: key, label, subscriptionTotal, perPersonCost, memberCount, byCategory };
    });
  }, [costHistory, teamActive, rates, range.start, range.end]);

  const categories = useMemo(
    () =>
      Array.from(new Set(costHistory.map((r) => r.category ?? "미분류"))).sort(),
    [costHistory]
  );

  const hasTrendData = monthlyTrendData.some((d) => d.subscriptionTotal > 0);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">라이선스 대시보드</h1>
          <p className="mt-1 text-sm text-slate-600">팀 서비스 비용과 갱신 일정을 한눈에 확인하세요.</p>
        </div>
        <Link href="/licenses/list" className="text-sm font-medium text-blue-600 hover:underline">
          라이선스 목록 →
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">월별 구독 라이선스 비용 추이</h2>
        <div className="mt-4 flex flex-wrap gap-2">
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
        {period === "custom" && (
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
        )}
        {period !== "custom" && (
          <p className="mt-2 text-xs text-slate-500">
            {range.start} ~ {range.end}
          </p>
        )}
        <div className="mt-5 h-[220px] w-full">
          {!hasTrendData ? (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">
              해당 기간 이력 데이터가 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    typeof v === "number"
                      ? `₩${v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString("ko-KR")}`
                      : String(v)
                  }
                />
                <Tooltip content={<CategoryTrendTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {categories.map((cat) => (
                  <Bar
                    key={cat}
                    dataKey={`byCategory.${cat}`}
                    name={cat}
                    stackId="cost"
                    fill={CATEGORY_COLORS[cat] ?? "#CBD5E1"}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">이달 구독 비용</h2>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
            <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-purple-100 text-purple-600">
              <IconSubscriptionPurple className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-slate-600">구독 월비용</p>
            <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-900">
              {formatCurrency(metrics.subscriptionMonthlySum)}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              연간 {formatCurrency(metrics.annualSubscriptionSum)}
            </p>
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/80 p-5 transition-shadow hover:shadow-md">
            <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-slate-200/80 text-slate-600">
              <IconShieldGray className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-slate-600">영구 라이선스</p>
            <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-900">
              {formatCurrency(metrics.perpetualPurchaseSum)}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              총 구매비용 · {metrics.perpetualServiceCount}개 서비스
            </p>
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
            <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-emerald-100 text-emerald-600">
              <IconCubeGreen className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-slate-600">서비스</p>
            <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-900">
              {serviceTotals.total}개
            </p>
            <p className="mt-2 text-sm text-slate-500">
              구독 {serviceTotals.sub} · 영구 {serviceTotals.perp}
            </p>
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
            <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-purple-100 text-purple-600">
              <IconUsersPurple className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-slate-600">팀원</p>
            <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-900">{teamActive.length}명</p>
          </div>
        </div>

        <div className="my-6 border-t border-slate-200" />

        <div>
          <h3 className="text-lg font-semibold text-slate-900">카테고리별 비용 분석</h3>
          <p className="mt-0.5 text-sm text-slate-500">구독 서비스 기준 월비용</p>
        </div>

        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[15%]" />
                <col className="w-[25%]" />
                <col className="w-[20%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                  <th className="pb-3 pr-2 align-bottom">카테고리</th>
                  <th className="pb-3 pr-2 text-right align-bottom">서비스 수</th>
                  <th className="pb-3 pr-2 text-right align-bottom">월비용 (구독)</th>
                  <th className="pb-3 pr-2 text-right align-bottom">영구 라이선스</th>
                  <th className="pb-3 text-right align-bottom">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedCategoryRows.map((row) => {
                  const pct =
                    totalSubscriptionMonthlyForShare > 0
                      ? (row.subscriptionMonthlyKrw / totalSubscriptionMonthlyForShare) * 100
                      : 0;
                  return (
                    <tr key={row.key} className="text-slate-800">
                      <td className="py-3 pr-2 align-top">
                        <span className="flex items-start gap-2 break-words">
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="min-w-0 break-words">{row.key}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-2 text-right align-top tabular-nums">{row.serviceCount}개</td>
                      <td className="break-words py-3 pr-2 text-right align-top font-medium tabular-nums text-slate-900">
                        {row.subscriptionMonthlyKrw > 0 ? formatCurrency(row.subscriptionMonthlyKrw) : "—"}
                      </td>
                      <td className="break-words py-3 pr-2 text-right align-top tabular-nums">
                        {row.perpetualKrw > 0 ? formatCurrency(row.perpetualKrw) : "—"}
                      </td>
                      <td className="py-3 text-right align-top tabular-nums text-slate-700">
                        {totalSubscriptionMonthlyForShare > 0 ? `${pct.toFixed(1)}%` : "0%"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="py-3 pr-2 align-top">합계</td>
                  <td className="py-3 pr-2 text-right align-top tabular-nums">{totalServicesInCategories}개</td>
                  <td className="break-words py-3 pr-2 text-right align-top tabular-nums text-indigo-600">
                    {formatCurrency(totalSubscriptionMonthlyForShare)}
                  </td>
                  <td className="break-words py-3 pr-2 text-right align-top tabular-nums">
                    {totalPerpetualKrwAcrossCategories > 0
                      ? formatCurrency(totalPerpetualKrwAcrossCategories)
                      : "—"}
                  </td>
                  <td className="py-3 text-right align-top">100%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mx-auto w-full shrink-0 lg:mx-0 lg:w-[280px] xl:w-[300px]">
            {chartData.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                표시할 구독 월비용 비중이 없습니다
              </div>
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      innerRadius={56}
                      outerRadius={88}
                      paddingAngle={1}
                    >
                      {chartData.map((entry, i) => (
                        <Cell key={`c-${i}`} fill={entry.fill} stroke="white" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [
                        formatCurrency(typeof value === "number" ? value : Number(value)),
                        "월비용"
                      ]}
                      contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0" }}
                    />
                    <Legend
                      layout="horizontal"
                      verticalAlign="bottom"
                      content={() => {
                        const totalVal = chartData.reduce((s, d) => s + d.value, 0);
                        if (!chartData.length) return null;
                        const mid = Math.ceil(chartData.length / 2);
                        const left = chartData.slice(0, mid);
                        const right = chartData.slice(mid);
                        const legendRow = (d: (typeof chartData)[0]) => {
                          const pctRounded = totalVal > 0 ? Math.round((d.value / totalVal) * 100) : 0;
                          return (
                            <span
                              key={d.name}
                              className="flex min-w-0 items-center gap-2 text-[11px] text-slate-700"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: d.fill }}
                              />
                              <span className="truncate">
                                {d.name} {pctRounded}%
                              </span>
                            </span>
                          );
                        };
                        return (
                          <div className="flex justify-center gap-6 pt-2 text-left">
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              {left.map(legendRow)}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              {right.map(legendRow)}
                            </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 1개월 내 갱신 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <IconCalendarOrange className="h-5 w-5" />
            </span>
            <h2 className="text-base font-semibold text-slate-900">1개월 내 갱신 예정 서비스</h2>
          </div>
          <span className="text-sm font-medium text-slate-600">{renewalItems.length}건</span>
        </div>

        {renewalItems.length === 0 ? (
          <div className="mt-8 flex flex-col items-center justify-center py-8 text-center">
            <IconEmptyBox className="h-14 w-14 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">1개월 내 갱신 예정 서비스가 없습니다</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {renewalItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-1">
                <Link
                  href={`/licenses/${item.id}`}
                  className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:text-blue-600 hover:underline"
                >
                  {item.name}
                </Link>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <span className="tabular-nums text-slate-600">{formatDateKorean(toIsoDate(item.date))}</span>
                  <span className="font-medium tabular-nums text-slate-700">
                    {item.daysLeft === 0 ? "D-Day" : `D-${item.daysLeft}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
