"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCurrency, formatDateKorean } from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export default function LicenseDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [license, setLicense] = useState<License | null>(null);
  const [assignee, setAssignee] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      const { data: row } = await supabase.from("services").select("*").eq("id", id).maybeSingle();
      const lic = (row ?? null) as License | null;
      setLicense(lic);
      if (lic?.assignee_id) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", lic.assignee_id).maybeSingle();
        setAssignee((p ?? null) as Profile | null);
      } else {
        setAssignee(null);
      }
      setLoading(false);
    };
    void run();
  }, [id]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  if (!license) {
    return (
      <p className="text-slate-600">
        라이선스를 찾을 수 없습니다.{" "}
        <Link href="/licenses/list" className="text-apollon-600 hover:underline">
          목록
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/licenses/list" className="text-sm text-apollon-600 hover:underline">
        ← 전체 라이선스
      </Link>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h1 className="text-2xl font-bold text-slate-900">{license.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {license.category} · {license.plan}
        </p>
        <dl className="mt-6 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <div>
            <dt className="text-slate-500">상태</dt>
            <dd className="font-medium text-slate-900">{license.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">비용</dt>
            <dd className="font-medium text-slate-900">
              {formatCurrency(Number(license.cost_monthly))} ({license.cost_type})
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">라이선스 수</dt>
            <dd className="font-medium text-slate-900">{license.license_count}</dd>
          </div>
          <div>
            <dt className="text-slate-500">다음 갱신</dt>
            <dd className="font-medium text-slate-900">{license.next_renewal ? formatDateKorean(license.next_renewal) : "-"}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-slate-500">담당자</dt>
            <dd className="font-medium text-slate-900">{assignee ? `${assignee.name} (${assignee.email})` : "-"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
