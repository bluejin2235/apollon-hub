"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LoanDetailModal } from "@/components/supplies/loan-detail-modal";
import { ReturnModal } from "@/components/supplies/return-modal";
import { formatSupplyDate, formatSupplyDateTime, loanDdayLabel, supplyDetailUrl } from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

type ReturnTarget = {
  loanId: string;
  location: string;
  supplyName: string;
};

type Props = {
  userId: string;
};

export function MyLoansTab({ userId }: Props) {
  const [active, setActive] = useState<SupplyLoanWithRelations[]>([]);
  const [history, setHistory] = useState<SupplyLoanWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);
  const [detailLoan, setDetailLoan] = useState<SupplyLoanWithRelations | null>(null);

  const load = useCallback(async () => {
    const [activeRes, histRes] = await Promise.all([
      supabase
        .from("supply_loans")
        .select("*, supply:supplies(id, code, name, location)")
        .eq("borrower_id", userId)
        .in("status", ["active", "overdue"])
        .is("returned_at", null)
        .order("due_date", { ascending: true }),
      supabase
        .from("supply_loans")
        .select("*, supply:supplies(id, code, name), borrower:profiles!borrower_id(id, name)")
        .eq("borrower_id", userId)
        .order("borrowed_at", { ascending: false })
        .limit(50)
    ]);

    setActive((activeRes.data ?? []) as SupplyLoanWithRelations[]);
    setHistory((histRes.data ?? []) as SupplyLoanWithRelations[]);
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
          <p className="mt-3 text-sm text-slate-500">대출 중인 비품이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {active.map((loan) => {
              const dday = loanDdayLabel(loan.due_date);
              return (
                <li key={loan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <Link
                      href={loan.supply?.code ? supplyDetailUrl(loan.supply.code) : "#"}
                      className="font-medium text-violet-700 hover:underline"
                    >
                      {loan.supply?.name ?? "비품"}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      반납예정 {formatSupplyDate(loan.due_date)}
                      <span className={`ml-2 font-semibold ${dday.overdue ? "text-rose-600" : ""}`}>{dday.text}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setReturnTarget({
                        loanId: loan.id,
                        location: loan.supply?.location ?? "",
                        supplyName: loan.supply?.name ?? "비품"
                      })
                    }
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500"
                  >
                    반납
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">대출 이력</h2>
        <p className="mt-1 text-xs text-slate-500">행을 클릭하면 상세 정보를 볼 수 있습니다.</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">물품</th>
                <th className="px-4 py-3">대출일</th>
                <th className="px-4 py-3">반납일</th>
                <th className="px-4 py-3">목적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((loan) => (
                <tr
                  key={loan.id}
                  onClick={() => setDetailLoan(loan)}
                  className="cursor-pointer transition hover:bg-violet-50/60"
                >
                  <td className="px-4 py-3 font-medium">{loan.supply?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatSupplyDateTime(loan.borrowed_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-slate-600" title={loan.purpose ?? ""}>
                    {loan.purpose ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {returnTarget ? (
        <ReturnModal
          open
          loanId={returnTarget.loanId}
          location={returnTarget.location}
          supplyName={returnTarget.supplyName}
          onClose={() => setReturnTarget(null)}
          onSuccess={() => void load()}
        />
      ) : null}

      <LoanDetailModal loan={detailLoan} onClose={() => setDetailLoan(null)} />
    </div>
  );
}
