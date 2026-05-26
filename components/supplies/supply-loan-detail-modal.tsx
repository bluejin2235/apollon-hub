"use client";

import { formatSupplyDateTime, imagePublicUrls, loanStatusLabel } from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations } from "@/lib/supplies/types";

type Props = {
  loan: SupplyLoanWithRelations;
  onClose: () => void;
};

export function SupplyLoanDetailModal({ loan, onClose }: Props) {
  const returnImageUrl = loan.return_image_path
    ? imagePublicUrls([loan.return_image_path])[0]
    : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-detail-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="loan-detail-title" className="text-lg font-bold text-slate-900">
            대출 이력 상세
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">대출자</dt>
            <dd className="font-medium text-slate-900">{loan.borrower?.name?.trim() || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">상태</dt>
            <dd className="font-medium text-slate-900">{loanStatusLabel(loan.status)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">대출목적</dt>
            <dd className="whitespace-pre-wrap text-slate-800">{loan.purpose}</dd>
          </div>
          <div>
            <dt className="text-slate-500">대출일</dt>
            <dd className="text-slate-800">{formatSupplyDateTime(loan.borrowed_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">반납일</dt>
            <dd className="text-slate-800">
              {loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}
            </dd>
          </div>
        </dl>

        {returnImageUrl ? (
          <div className="mt-5">
            <p className="text-sm font-medium text-slate-700">반납 사진</p>
            <div className="mt-2 flex max-h-64 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={returnImageUrl} alt="반납 사진" className="max-h-64 w-full object-contain" />
            </div>
          </div>
        ) : null}

        {loan.return_note ? (
          <div className="mt-5">
            <p className="text-sm font-medium text-slate-700">반납 특이사항</p>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
              {loan.return_note}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
