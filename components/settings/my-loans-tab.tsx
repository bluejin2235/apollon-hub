"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyDate, formatSupplyDateTime, supplyDetailPath, supplyReturnPath } from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

type Props = {
  userId: string;
};

export function MyLoansTab({ userId }: Props) {
  const [active, setActive] = useState<(SupplyLoanWithRelations & { supply?: { id: string; name: string; code: string } | null })[]>([]);
  const [history, setHistory] = useState<typeof active>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [activeRes, histRes] = await Promise.all([
      supabase
        .from("supply_loans")
        .select("*, supply:supplies(id, code, name)")
        .eq("borrower_id", userId)
        .eq("status", "active")
        .order("due_date", { ascending: true }),
      supabase
        .from("supply_loans")
        .select("*, supply:supplies(id, code, name)")
        .eq("borrower_id", userId)
        .order("borrowed_at", { ascending: false })
        .limit(50)
    ]);

    setActive((activeRes.data ?? []) as typeof active);
    setHistory((histRes.data ?? []) as typeof active);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">불러오는 중…</p>;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-slate-900">현재 대출 중</h2>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">대출 중인 물품이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {active.map((loan) => (
              <li key={loan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <Link
                    href={loan.supply?.id ? supplyDetailPath(loan.supply.id) : "#"}
                    className="font-medium text-violet-700 hover:underline"
                  >
                    {loan.supply?.name ?? "물품"}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">반납예정 {formatSupplyDate(loan.due_date)}</p>
                </div>
                {loan.supply?.id && isMobileDevice() ? (
                  <Link
                    href={supplyReturnPath(loan.supply.id)}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white"
                  >
                    반납
                  </Link>
                ) : (
                  <span className="text-xs text-slate-500">반납은 모바일에서</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">대출 이력</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">물품</th>
                <th className="px-4 py-3">대출일</th>
                <th className="px-4 py-3">반납일</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-4 py-3 font-medium">{loan.supply?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatSupplyDateTime(loan.borrowed_at)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}
                  </td>
                  <td className="px-4 py-3">{loan.status === "returned" ? "반납완료" : "대출중"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
