"use client";

import {
  effectiveLoanStatus,
  formatSupplyDate,
  formatSupplyDateTime,
  loanStatusBadge
} from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations } from "@/lib/supplies/types";

type Props = {
  loan: SupplyLoanWithRelations | null;
  onClose: () => void;
};

export function LoanDetailModal({ loan, onClose }: Props) {
  if (!loan) return null;

  const status = effectiveLoanStatus(loan);
  const badge = loanStatusBadge(status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">대출 이력 상세</h2>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-slate-500">대출자</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{loan.borrower?.name?.trim() || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">사용 목적</dt>
            <dd className="mt-0.5 text-slate-800">{loan.purpose?.trim() || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">대출 시작</dt>
            <dd className="mt-0.5 text-slate-800">{formatSupplyDateTime(loan.borrowed_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">반납 예정일</dt>
            <dd className="mt-0.5 text-slate-800">{formatSupplyDate(loan.due_date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">실제 반납일</dt>
            <dd className="mt-0.5 text-slate-800">{loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">반납 사진</dt>
            <dd className="mt-1">
              {loan.return_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={loan.return_image_url}
                  alt="반납 사진"
                  className="max-h-56 w-full rounded-lg border border-slate-200 object-contain"
                />
              ) : (
                <span className="text-slate-500">사진 없음</span>
              )}
            </dd>
          </div>
          {loan.note?.trim() ? (
            <div>
              <dt className="text-xs font-medium text-slate-500">특이사항</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{loan.note.trim()}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
