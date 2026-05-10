"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  activeProfiles,
  aggregateByCategory,
  categoryChartColors,
  daysUntil,
  formatCurrency,
  formatDateKorean,
  nextRenewalDate,
  totalActiveSubscriptionMonthly,
  totalPerpetualPurchase
} from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicensesDashboardPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const [l, p] = await Promise.all([
        supabase.from("services").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, email, name, department, role, status, created_at").order("created_at", { ascending: true })
      ]);
      setLicenses((l.data ?? []) as License[]);
      setProfiles((p.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, []);

  const assigneeMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  const active = useMemo(() => activeProfiles(profiles), [profiles]);
  const byCat = useMemo(() => aggregateByCategory(licenses), [licenses]);
  const renewal = nextRenewalDate(licenses);
  const subMonthly = totalActiveSubscriptionMonthly(licenses);
  const perpetual = totalPerpetualPurchase(licenses);

  if (loading) {
    return <p className="text-slate-300">불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl font-bold text-white">라이선스 대시보드</h1>
        <p className="mt-1 text-sm text-slate-400">팀 서비스 비용과 만료 일정을 한눈에 확인하세요.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">활성 프로필</p>
          <p className="mt-2 text-3xl font-semibold text-white">{active.length}</p>
          <p className="mt-1 text-xs text-slate-500">상태가 &quot;근무&quot;인 팀원</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">구독 월 비용 합계</p>
          <p className="mt-2 text-3xl font-semibold text-apollon-300">{formatCurrency(subMonthly)}</p>
          <p className="mt-1 text-xs text-slate-500">월간·연간 과금 항목</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">영구 구매 합계</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-300">{formatCurrency(perpetual)}</p>
          <p className="mt-1 text-xs text-slate-500">영구 라이선스</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">다가오는 갱신</p>
          <p className="mt-2 text-xl font-semibold text-white">{renewal ? formatDateKorean(renewal) : "-"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {renewal && daysUntil(renewal) !== null ? `${daysUntil(renewal)}일 남음` : "예정 없음"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">카테고리별 라이선스 수</h2>
        <ul className="mt-4 space-y-2">
          {Object.entries(byCat).map(([cat, count]) => (
            <li key={cat} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryChartColors[cat] ?? "#94a3b8" }} />
                {cat}
              </span>
              <span className="font-medium text-white">{count}</span>
            </li>
          ))}
          {Object.keys(byCat).length === 0 ? <li className="text-sm text-slate-500">등록된 서비스가 없습니다.</li> : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">최근 서비스</h2>
          <Link href="/licenses/list" className="text-sm font-medium text-apollon-300 hover:underline">
            전체 목록 →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">서비스</th>
                <th className="py-2 pr-4">카테고리</th>
                <th className="py-2 pr-4">상태</th>
                <th className="py-2 pr-4">비용</th>
                <th className="py-2 pr-4">담당</th>
              </tr>
            </thead>
            <tbody>
              {licenses.slice(0, 8).map((row) => {
                const assignee = row.assignee_id ? assigneeMap.get(row.assignee_id) : null;
                return (
                  <tr key={row.id} className="border-b border-slate-800/80">
                    <td className="py-3 pr-4 font-medium text-white">
                      <Link href={`/licenses/${row.id}`} className="hover:text-apollon-300 hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{row.category}</td>
                    <td className="py-3 pr-4">{row.status}</td>
                    <td className="py-3 pr-4">
                      {formatCurrency(Number(row.cost_monthly))}
                      <span className="text-xs text-slate-500"> · {row.cost_type}</span>
                    </td>
                    <td className="py-3 pr-4">{assignee?.name ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {licenses.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">등록된 서비스가 없습니다.</p> : null}
        </div>
      </section>
    </div>
  );
}
