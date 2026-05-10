"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicensesListPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const [l, p] = await Promise.all([
        supabase.from("services").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, name, email, department, role, status")
      ]);
      setLicenses((l.data ?? []) as License[]);
      setProfiles((p.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, []);

  const assigneeMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((x) => m.set(x.id, x));
    return m;
  }, [profiles]);

  if (loading) {
    return <p className="text-slate-300">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">전체 라이선스</h1>
        <p className="mt-1 text-sm text-slate-400">등록된 모든 서비스 라이선스입니다.</p>
      </header>
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">플랜</th>
              <th className="px-4 py-3">카테고리</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">비용</th>
              <th className="px-4 py-3">담당</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((row) => {
              const a = row.assignee_id ? assigneeMap.get(row.assignee_id) : null;
              return (
                <tr key={row.id} className="border-b border-slate-800/80">
                  <td className="px-4 py-3">
                    <Link href={`/licenses/${row.id}`} className="font-medium text-apollon-300 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.plan}</td>
                  <td className="px-4 py-3">{row.category}</td>
                  <td className="px-4 py-3">{row.status}</td>
                  <td className="px-4 py-3">
                    {formatCurrency(Number(row.cost_monthly))} ({row.cost_type})
                  </td>
                  <td className="px-4 py-3">{a?.name ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {licenses.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">데이터가 없습니다.</p> : null}
      </div>
    </div>
  );
}
