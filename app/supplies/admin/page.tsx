"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QrPrintSheet } from "@/components/supplies/qr-print-sheet";
import { SupplyFormModal } from "@/components/supplies/supply-form-modal";
import { syncOverdueLoans } from "@/lib/supplies/operations";
import { formatSupplyDate, formatSupplyDateTime, isSuperAdmin, effectiveLoanStatus } from "@/lib/supplies/utils";
import type { ProfileLite, SupplyLoanWithRelations, SupplyWithManager } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SuppliesAdminPage() {
  const router = useRouter();
  const { status, profile } = useRequirePortalSession();
  const [loans, setLoans] = useState<SupplyLoanWithRelations[]>([]);
  const [supplies, setSupplies] = useState<SupplyWithManager[]>([]);
  const [managers, setManagers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    await syncOverdueLoans();
    const [loanRes, supRes, profRes] = await Promise.all([
      supabase
        .from("supply_loans")
        .select("*, supply:supplies(id, code, name), borrower:profiles!borrower_id(id, name)")
        .in("status", ["active", "overdue"])
        .is("returned_at", null)
        .order("due_date", { ascending: true }),
      supabase.from("supplies").select("id, code, name").order("code"),
      supabase.from("profiles").select("id, name, email").order("name")
    ]);

    setLoans((loanRes.data ?? []) as SupplyLoanWithRelations[]);
    setSupplies((supRes.data ?? []) as SupplyWithManager[]);
    setManagers((profRes.data ?? []) as ProfileLite[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    if (!isSuperAdmin(profile?.role)) {
      router.replace("/supplies");
      return;
    }
    void load();
  }, [status, profile?.role, router, load, refreshKey]);

  const overdueLoans = useMemo(
    () => loans.filter((l) => effectiveLoanStatus(l) === "overdue"),
    [loans]
  );

  const qrItems = useMemo(() => supplies.map((s) => ({ code: s.code, name: s.name })), [supplies]);

  if (status !== "ready" || !isSuperAdmin(profile?.role)) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/supplies" className="text-sm font-medium text-violet-600 hover:underline">
            ← 비품 목록
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">비품 관리 · 관리자</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            disabled={qrItems.length === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            전체 QR 일괄 출력
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            비품 등록
          </button>
        </div>
      </div>

      {overdueLoans.length > 0 ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-bold text-rose-900">연체 목록</h2>
          <ul className="mt-3 space-y-2">
            {overdueLoans.map((loan) => (
              <li key={loan.id} className="rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm">
                <span className="font-semibold text-rose-800">{loan.supply?.name}</span>
                <span className="text-rose-700">
                  {" "}
                  · {loan.borrower?.name ?? "—"} · 반납예정 {formatSupplyDate(loan.due_date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">전체 대출 현황</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">불러오는 중…</p>
        ) : loans.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">대출 중인 항목이 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">물품명</th>
                  <th className="px-4 py-3">대출자</th>
                  <th className="px-4 py-3">대출일</th>
                  <th className="px-4 py-3">반납예정일</th>
                  <th className="px-4 py-3">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loans.map((loan) => {
                  const st = effectiveLoanStatus(loan);
                  return (
                    <tr key={loan.id} className={st === "overdue" ? "bg-rose-50/80" : undefined}>
                      <td className="px-4 py-3 font-medium">{loan.supply?.name ?? "—"}</td>
                      <td className="px-4 py-3">{loan.borrower?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatSupplyDateTime(loan.borrowed_at)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatSupplyDate(loan.due_date)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            st === "overdue" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {st === "overdue" ? "연체" : "대출중"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SupplyFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        managers={managers}
      />

      {qrOpen ? <QrPrintSheet items={qrItems} title="전체 비품 QR" onClose={() => setQrOpen(false)} /> : null}
    </div>
  );
}
