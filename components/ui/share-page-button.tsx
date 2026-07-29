"use client";

import { Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type SharePageButtonProps = {
  className?: string;
};

const defaultClassName =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50";

export function SharePageButton({ className = defaultClassName }: SharePageButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[SharePageButton] clipboard copy failed", e);
    }
  }, []);

  return (
    <button type="button" onClick={() => void handleClick()} className={className}>
      <Share2 className="h-4 w-4 shrink-0" aria-hidden />
      {copied ? "복사됨!" : "공유"}
    </button>
  );
}
