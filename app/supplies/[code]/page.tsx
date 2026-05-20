"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BorrowModal } from "@/components/supplies/borrow-modal";
import { LoanDetailModal } from "@/components/supplies/loan-detail-modal";
import { QrPrintSheet } from "@/components/supplies/qr-print-sheet";
import { ReturnModal } from "@/components/supplies/return-modal";
import { SupplyFormModal } from "@/components/supplies/supply-form-modal";
import { deleteSupply, syncOverdueLoans } from "@/lib/supplies/operations";
import {
  categoryPlaceholder,
  formatSupplyDate,
  formatSupplyDateTime,
  isSuperAdmin,
  itemStatusLabel,
  loanDdayLabel,
  supplyStatusBadge
} from "@/lib/supplies/utils";
import type { ProfileLite, Supply, SupplyItem, SupplyLoanWithRelations, SupplyWithManager } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SupplyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const code = decodeURIComponent(String(params.code ?? ""));
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithManager | null>(null);
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [history, setHistory] = useState<SupplyLoanWithRelations[]>([]);
  const [activeLoan, setActiveLoan] = useState<SupplyLoanWithRelations | null>(null);
  const [managers, setManagers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [detailLoan, setDetailLoan] = useState<SupplyLoanWithRelations | null>(null);

  const userId = profile?.id ?? "";
  const admin = isSuperAdmin(profile?.role);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    await syncOverdueLoans();

    const { data: sup, error } = await supabase
      .from("supplies")
      .select("*, manager:profiles!manager_id(id, name, email)")
      .eq("code", code)
      .maybeSingle();

    if (error || !sup) {
      setSupply(null);
      setLoading(false);
      return;
    }

    const mgr = sup.manager as { id: string; name: string | null; email?: string | null } | null;
    const { manager: _m, ...rest } = sup;
    const supplyRow = { ...rest, manager: mgr ? { id: mgr.id, name: mgr.name, email: mgr.email } : null } as SupplyWithManager;
    setSupply(supplyRow);

    const [itemsRes, histRes, activeRes, profRes] = await Promise.all([
      supabase.from("supply_items").select("*").eq("supply_id", supplyRow.id).order("item_name"),
      supabase
        .from("supply_loans")
        .select("*, borrower:profiles!borrower_id(id, name, email)")
        .eq("supply_id", supplyRow.id)
        .order("borrowed_at", { ascending: false })
        .limit(10),
      supabase
        .from("supply_loans")
        .select("*, borrower:profiles!borrower_id(id, name, email)")
        .eq("supply_id", supplyRow.id)
        .in("status", ["active", "overdue"])
        .is("returned_at", null)
        .order("borrowed_at", { ascending: false })
        .limit(1),
      supabase.from("profiles").select("id, name, email").order("name")
    ]);

    setItems((itemsRes.data ?? []) as SupplyItem[]);
    setHistory((histRes.data ?? []) as SupplyLoanWithRelations[]);
    const activeRows = activeRes.data ?? [];
    setActiveLoan((activeRows[0] as SupplyLoanWithRelations) ?? null);
    setManagers((profRes.data ?? []) as ProfileLite[]);
    setLoading(false);
  }, [code]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const myActiveLoan = useMemo(
    () => (activeLoan?.borrower_id === userId ? activeLoan : null),
    [activeLoan, userId]
  );

  const canBorrow =
    supply &&
    supply.status !== "maintenance" &&
    supply.available_qty > 0 &&
    !myActiveLoan;

  const handleDelete = async () => {
    if (!supply || !confirm("이 비품을 삭제할까요?")) return;
    const { error } = await deleteSupply(supply.id);
    if (error) alert(error);
    else router.push("/supplies");
  };

  if (status !== "ready") return null;

  if (loading) return <p className="text-sm text-slate-500">불러오는 중…</p>;

  if (!supply) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center">
        <p className="text-slate-600">비품을 찾을 수 없습니다.</p>
        <Link href="/supplies" className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  const badge = supplyStatusBadge(supply.status);
  const placeholderClass = categoryPlaceholder(supply.category);
  const borrowerName = activeLoan?.borrower?.name?.trim() || "—";

  return (
    <div className="space-y-8">
      <Link href="/supplies" className="text-sm font-medium text-violet-600 hover:underline">
        ← 비품 목록
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-6">
          <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {supply.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={supply.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-4xl font-bold ${placeholderClass}`}>
                {supply.category}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">{supply.code}</p>
            <h1 className="text-2xl font-bold text-slate-900">{supply.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              구역 {supply.category} · {supply.location}
            </p>
            <p className="mt-1 text-sm text-slate-600">담당 {supply.manager?.name?.trim() || "—"}</p>
            <span className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-semibold ${badge.className}`}>{badge.label}</span>
            {supply.status === "borrowed" && activeLoan ? (
              <p className="mt-3 text-sm text-amber-800">
                대출자 {borrowerName} · 반납예정 {formatSupplyDate(activeLoan.due_date)}
                <span className={`ml-2 font-semibold ${loanDdayLabel(activeLoan.due_date).overdue ? "text-rose-600" : ""}`}>
                  {loanDdayLabel(activeLoan.due_date).text}
                </span>
              </p>
            ) : null}
            {supply.description ? <p className="mt-3 text-sm text-slate-600">{supply.description}</p> : null}
            <p className="mt-2 text-xs text-slate-500">
              수량 {supply.quantity} · 대출가능 {supply.available_qty}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canBorrow ? (
            <button
              type="button"
              onClick={() => setBorrowOpen(true)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              대출 신청
            </button>
          ) : null}
          {myActiveLoan ? (
            <button
              type="button"
              onClick={() => setReturnOpen(true)}
              className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
            >
              반납하기
            </button>
          ) : null}
          {admin ? (
            <>
              <button type="button" onClick={() => setQrOpen(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                QR 출력
              </button>
              <button type="button" onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                수정
              </button>
              <button type="button" onClick={() => void handleDelete()} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                삭제
              </button>
            </>
          ) : null}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">세부 구성품</h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">등록된 구성품이 없습니다.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="py-2 pr-4">구성품명</th>
                <th className="py-2 pr-4">수량</th>
                <th className="py-2">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 pr-4 font-medium">{it.item_name}</td>
                  <td className="py-2 pr-4">{it.quantity}</td>
                  <td className="py-2">{itemStatusLabel(it.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">대출 이력</h2>
        <p className="mt-1 text-xs text-slate-500">행을 클릭하면 상세 정보를 볼 수 있습니다.</p>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">이력이 없습니다.</p>
        ) : (
          <table className="mt-3 w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="py-2 pr-4">대출자</th>
                <th className="py-2 pr-4">대출일</th>
                <th className="py-2 pr-4">반납일</th>
                <th className="py-2">목적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {history.map((loan) => (
                <tr
                  key={loan.id}
                  onClick={() => setDetailLoan(loan)}
                  className="cursor-pointer transition hover:bg-violet-50/60"
                >
                  <td className="py-2 pr-4">{loan.borrower?.name?.trim() || "—"}</td>
                  <td className="py-2 pr-4 text-slate-600">{formatSupplyDateTime(loan.borrowed_at)}</td>
                  <td className="py-2 pr-4 text-slate-600">{loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}</td>
                  <td className="max-w-[200px] truncate py-2 text-slate-600" title={loan.purpose ?? ""}>
                    {loan.purpose ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <BorrowModal
        supply={supply as Supply}
        borrowerId={userId}
        open={borrowOpen}
        onClose={() => setBorrowOpen(false)}
        onSuccess={() => void load()}
      />

      <SupplyFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => void load()}
        managers={managers}
        supply={supply}
        initialItems={items}
      />

      {myActiveLoan && returnOpen ? (
        <ReturnModal
          open
          loanId={myActiveLoan.id}
          location={supply.location}
          supplyName={supply.name}
          onClose={() => setReturnOpen(false)}
          onSuccess={() => void load()}
        />
      ) : null}

      <LoanDetailModal loan={detailLoan} onClose={() => setDetailLoan(null)} />

      {qrOpen ? <QrPrintSheet items={[{ code: supply.code, name: supply.name }]} onClose={() => setQrOpen(false)} /> : null}
    </div>
  );
}
