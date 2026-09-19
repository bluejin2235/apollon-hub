"use client";

import { useEffect, useState } from "react";

export type LunaLimitsStats = {
  image_indexed: number;
  image_total: number;
  image_pct: number;
};

const FALLBACK: LunaLimitsStats = {
  image_indexed: 0,
  image_total: 104_273,
  image_pct: 0
};

function formatPct(n: number): string {
  if (n <= 0) return "0";
  if (n < 1) return n.toFixed(1);
  return String(Math.round(n));
}

export function LimitsDisclosure() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<LunaLimitsStats>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/luna/limits-stats");
        if (!res.ok) return;
        const data = (await res.json()) as Partial<LunaLimitsStats>;
        if (cancelled) return;
        if (
          typeof data.image_indexed === "number" &&
          typeof data.image_total === "number"
        ) {
          setStats({
            image_indexed: data.image_indexed,
            image_total: data.image_total,
            image_pct:
              typeof data.image_pct === "number"
                ? data.image_pct
                : data.image_total > 0
                  ? (data.image_indexed / data.image_total) * 100
                  : 0
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const indexedLabel = stats.image_indexed.toLocaleString("ko-KR");
  const totalLabel = stats.image_total.toLocaleString("ko-KR");
  const pctLabel = formatPct(stats.image_pct);

  return (
    <div className="mt-5 w-full max-w-md text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-[12px] font-semibold text-[#9aa0a8] hover:text-[#6b6f76]"
        aria-expanded={open}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        루나가 아직 못 보는 것
      </button>
      {open ? (
        <ul className="mt-2 space-y-1.5 rounded-[10px] border border-[#e7e8ec] bg-[#FAFAFB] px-3.5 py-3 text-[12px] leading-[1.55] text-[#6b6f76]">
          <li>
            · 이미지는 {pctLabel}%만 읽었어요 ({totalLabel}장 중 {indexedLabel}
            장)
          </li>
          <li>· 2020년 이전 자료는 잘 못 찾아요</li>
          <li>· 한글(hwp) 문서와 도면 PDF 는 안 읽어요</li>
          <li>· 계약서·견적 상세는 파일명만 알아요</li>
        </ul>
      ) : null}
    </div>
  );
}

/** 답변 한 줄 — 오래된 자료일 때 */
export function looksPre2020(text: string): boolean {
  if (/2020년\s*이전|201[0-9]|200[0-9]/.test(text)) return true;
  if (/\/20(0\d|1\d)\b|\\20(0\d|1\d)\b/.test(text)) return true;
  if (/\b20(0\d|1\d)[01]\d[0-3]\d\b/.test(text)) return true;
  return false;
}
