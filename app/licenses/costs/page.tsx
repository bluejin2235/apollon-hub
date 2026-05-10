"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, isSubscription } from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicensesCostsPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.from("services").select("*").order("category", { ascending: true });
      setLicenses((data ?? []) as License[]);
      setLoading(false);
    };
    void run();
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<string, { monthly: number; perpetual: number }>();
    licenses.forEach((l) => {
      const cur = m.get(l.category) ?? { monthly: 0, perpetual: 0 };
      if (isSubscription(l.cost_type)) {
        cur.monthly += Number(l.cost_monthly || 0);
      } else if (l.cost_type === "영구") {
        cur.perpetual += Number(l.cost_monthly || 0);
      }
      m.set(l.category, cur);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [licenses]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">비용 현황</h1>
        <p className="mt-1 text-sm text-slate-600">카테고리별 월 구독·영구 구매 금액 요약입니다.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {byCategory.map(([cat, v]) => (
          <div key={cat} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-semibold text-slate-900">{cat}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between text-slate-700">
                <dt>구독(월간·연간) 월 환산 합</dt>
                <dd className="font-medium text-apollon-600">{formatCurrency(v.monthly)}</dd>
              </div>
              <div className="flex justify-between text-slate-700">
                <dt>영구 구매 합</dt>
                <dd className="font-medium text-emerald-700">{formatCurrency(v.perpetual)}</dd>
              </div>
            </dl>
          </div>
        ))}
        {byCategory.length === 0 ? <p className="text-sm text-slate-500">표시할 데이터가 없습니다.</p> : null}
      </div>
    </div>
  );
}
