"use client";

import { useEffect, useState } from "react";
import type { NasExplorerPathPair } from "@/lib/luna/nas-path";

const COPY_TOAST = "경로를 복사했어요 — 탐색기에 붙여넣기";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function NasPathCopyLine({
  label,
  path,
  onCopyToast
}: {
  label: string;
  path: string;
  onCopyToast?: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!path) return null;

  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-0.5 w-7 shrink-0 text-[10px] font-bold text-[#9aa0a8]">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-[1.55] text-[#2a2c31]">
        {path}
      </span>
      <button
        type="button"
        aria-label={`${label} 복사`}
        className="shrink-0 rounded-md bg-[#EEEDFE] px-2 py-0.5 text-[10.5px] font-semibold text-[#534AB7] hover:bg-[#E4E2FA]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void writeClipboard(path).then((ok) => {
            if (!ok) {
              onCopyToast?.("복사에 실패했어요. 경로를 직접 선택해 복사해 주세요.");
              return;
            }
            setCopied(true);
            onCopyToast?.(COPY_TOAST);
          });
        }}
      >
        {copied ? "복사됨" : `${label} 복사`}
      </button>
    </div>
  );
}

export function NasPathDualCopy({
  pair,
  unc,
  onCopyToast,
  className
}: {
  pair: NasExplorerPathPair | null | undefined;
  unc?: string;
  onCopyToast?: (message: string) => void;
  className?: string;
}) {
  if (!pair || (!pair.office && !pair.laptop && !unc)) return null;

  return (
    <div
      className={`space-y-1 ${className ?? ""}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      <NasPathCopyLine
        label={pair.officeLabel}
        path={pair.office}
        onCopyToast={onCopyToast}
      />
      <NasPathCopyLine
        label={pair.laptopLabel}
        path={pair.laptop}
        onCopyToast={onCopyToast}
      />
      {unc ? (
        <NasPathCopyLine label="UNC" path={unc} onCopyToast={onCopyToast} />
      ) : null}
    </div>
  );
}
