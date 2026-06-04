"use client";

import { SupplyInfoCard } from "@/components/supplies/supply-info-card";
import type { SupplyWithRelations } from "@/lib/supplies/types";

type Props = {
  open: boolean;
  supply: SupplyWithRelations;
  onConfirm: () => void;
  onRescan: () => void;
};

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function SupplyScanConfirmModal({ open, supply, onConfirm, onRescan }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-confirm-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-600" />
          <h2 id="scan-confirm-title" className="text-lg font-bold text-slate-900">
            QR 인식되었습니다
          </h2>
        </div>

        <div className="mt-4">
          <SupplyInfoCard supply={supply} />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onRescan}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            다시 스캔
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
