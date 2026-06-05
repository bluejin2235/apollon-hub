"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WarehouseMapModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="warehouse-map-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="warehouse-map-title" className="text-lg font-bold text-slate-900">
            보관위치 안내
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/warehouse-map.png"
          alt="창고 보관 위치 배치도"
          className="mt-4 h-auto w-full rounded-lg border border-slate-200"
        />
      </div>
    </div>
  );
}
