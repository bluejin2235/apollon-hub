"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { License, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicensesMembersPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const [l, p] = await Promise.all([
        supabase.from("services").select("*").eq("is_hub_card", false),
        supabase.from("profiles").select("id, email, name, department, role, status, created_at").order("name", { ascending: true })
      ]);
      setLicenses((l.data ?? []) as License[]);
      setProfiles((p.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, []);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    licenses.forEach((row) => {
      if (!row.assignee_id) return;
      m.set(row.assignee_id, (m.get(row.assignee_id) ?? 0) + 1);
    });
    return m;
  }, [licenses]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">멤버별</h1>
        <p className="mt-1 text-sm text-slate-600">담당자 기준으로 할당된 서비스 수를 확인합니다.</p>
      </header>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm text-slate-800">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">부서</th>
              <th className="px-4 py-3">담당 서비스 수</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                <td className="px-4 py-3">{p.department}</td>
                <td className="px-4 py-3">{counts.get(p.id) ?? 0}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/licenses/members/${p.id}`} className="text-apollon-600 hover:underline">
                    상세
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
