"use client";

import { useEffect } from "react";

type Props = {
  images: string[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

export function ImageLightbox({ images, index, open, onClose, onIndexChange }: Props) {
  const len = images.length;
  const safeIndex = len > 0 ? Math.min(Math.max(0, index), len - 1) : 0;
  const currentSrc = len > 0 ? images[safeIndex] : null;
  const showNav = len > 1;

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
      if (!showNav) return;
      const i = Math.min(Math.max(0, index), len - 1);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange(i > 0 ? i - 1 : len - 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange(i < len - 1 ? i + 1 : 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, len, index, showNav, onClose, onIndexChange]);

  if (!open || len === 0 || !currentSrc) return null;

  const goPrev = () => onIndexChange(safeIndex > 0 ? safeIndex - 1 : len - 1);
  const goNext = () => onIndexChange(safeIndex < len - 1 ? safeIndex + 1 : 0);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/88 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 확대 보기"
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
        {showNav ? (
          <p className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-medium tabular-nums text-white">
            {safeIndex + 1} / {len}
          </p>
        ) : null}

        {showNav ? (
          <button
            type="button"
            aria-label="이전 이미지"
            className="absolute left-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/25 sm:left-2"
            onClick={goPrev}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
            </svg>
          </button>
        ) : null}

        {showNav ? (
          <button
            type="button"
            aria-label="다음 이미지"
            className="absolute right-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/25 sm:right-2"
            onClick={goNext}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
            </svg>
          </button>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentSrc}
          alt=""
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
