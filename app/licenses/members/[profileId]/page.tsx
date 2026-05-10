"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicensesMemberDetailPage() {
  const params = useParams();
  const profileId = typeof params.profileId === "string" ? params.profileId : "";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileId) return;
    const run = async () => {
      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", profileId).maybeSingle(),
        supabase.from("services").select("*").eq("assignee_id", profileId).order("name", { ascending: true })
      ]);
      setProfile((p ?? null) as Profile | null);
      setLicenses((l ?? []) as License[]);
      setLoading(false);
    };
    void run();
  }, [profileId]);

  const totalMonthly = useMemo(
    () => licenses.reduce((s, x) => s + Number(x.cost_monthly || 0), 0),
    [licenses]
  );

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  if (!profile) {
    return (
      <p className="text-slate-600">
        프로필을 찾을 수 없습니다.{" "}
        <Link href="/licenses/members" className="text-apollon-600 hover:underline">
          목록
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Link href="/licenses/members" className="text-sm text-apollon-600 hover:underline">
          ← 멤버별 라이선스
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{profile.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {profile.department} · {profile.email}
        </p>
        <p className="mt-2 text-sm text-slate-700">담당 서비스 월 비용 합계: {formatCurrency(totalMonthly)}</p>
      </header>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm text-slate-800">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">서비스</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">비용</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/licenses/${row.id}`} className="font-medium text-apollon-600 hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">
                  {formatCurrency(Number(row.cost_monthly))} ({row.cost_type})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {licenses.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">담당 서비스가 없습니다.</p> : null}
      </div>
    </div>
  );
}
