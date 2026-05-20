"use client";

import { useCallback, useEffect, useState } from "react";
import { ReturnModal } from "@/components/supplies/return-modal";
import { formatSupplyDate, loanDdayLabel } from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

type ReturnTarget = {
  loanId: string;
  location: string;
  supplyName: string;
};

type Props = {
  userId: string;
  onReturned?: () => void;
};

export function MyLoansWidget({ userId, onReturned }: Props) {
  const [loans, setLoans] = useState<SupplyLoanWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("supply_loans")
      .select("*, supply:supplies(id, code, name, category, location)")
      .eq("borrower_id", userId)
      .in("status", ["active", "overdue"])
      .is("returned_at", null)
      .order("due_date", { ascending: true });

    if (error) {
      console.error("[my-loans]", error);
      setLoans([]);
    } else {
      setLoans((data ?? []) as SupplyLoanWithRelations[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || loans.length === 0) return null;

  return (
    <>
      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-violet-900">내 대출 현황</h2>
        <ul className="mt-3 space-y-3">
          {loans.map((loan) => {
            const dday = loanDdayLabel(loan.due_date);
            return (
              <li
                key={loan.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{loan.supply?.name ?? "비품"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    반납예정 {formatSupplyDate(loan.due_date)}
                    <span className={`ml-2 font-semibold ${dday.overdue ? "text-rose-600" : "text-violet-700"}`}>
                      {dday.text}
                    </span>
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
                  className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500"
                >
                  반납
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {returnTarget ? (
        <ReturnModal
          open
          loanId={returnTarget.loanId}
          location={returnTarget.location}
          supplyName={returnTarget.supplyName}
          onClose={() => setReturnTarget(null)}
          onSuccess={() => {
            void load();
            onReturned?.();
          }}
        />
      ) : null}
    </>
  );
}
