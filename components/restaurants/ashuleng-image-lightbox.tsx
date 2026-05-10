"use client";

import { useEffect } from "react";

export type AshulengLightboxItem = {
  id: string;
  src: string;
  /** true면 빨간 「메뉴」 뱃지 표시 */
  showMenuBadge: boolean;
};

type Props = {
  open: boolean;
  items: AshulengLightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

export function AshulengImageLightbox({ open, items, index, onClose, onIndexChange }: Props) {
  const len = items.length;
  const safeIndex = len > 0 ? Math.min(Math.max(0, index), len - 1) : 0;
  const current = len > 0 ? items[safeIndex] : null;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || len === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const i = Math.min(Math.max(0, index), len - 1);
        onIndexChange(i > 0 ? i - 1 : len - 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const i = Math.min(Math.max(0, index), len - 1);
        onIndexChange(i < len - 1 ? i + 1 : 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, len, index, onClose, onIndexChange]);

  if (!open || len === 0 || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/88 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="사진 확대 보기"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="닫기"
        className="absolute right-4 top-4 z-[90] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
      <div
        className="relative flex max-h-[min(92vh,900px)] w-full max-w-[min(96vw,1200px)] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-medium tabular-nums text-white">
          {safeIndex + 1} / {len}
        </p>

        {current.showMenuBadge ? (
          <span
            className="absolute left-3 top-12 z-10 rounded bg-red-600/95 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md sm:left-4 sm:top-14 sm:text-xs"
            title="메뉴 이미지"
          >
            메뉴
          </span>
        ) : null}

        <button
          type="button"
          aria-label="이전 사진"
          className="absolute left-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/25 sm:left-2"
          onClick={() => onIndexChange(safeIndex > 0 ? safeIndex - 1 : len - 1)}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="다음 사진"
          className="absolute right-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/25 sm:right-2"
          onClick={() => onIndexChange(safeIndex < len - 1 ? safeIndex + 1 : 0)}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </button>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.src} alt="" className="max-h-[min(85vh,820px)] max-w-full rounded-lg object-contain shadow-2xl" />
      </div>
    </div>
  );
}
