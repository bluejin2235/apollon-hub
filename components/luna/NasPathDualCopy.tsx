"use client";

import { Check, Folder, HardDrive } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { raiPathForOfficePath, type NasPathSettings } from "@/lib/luna/nas-path";
import type { NasExplorerPathPair } from "@/lib/luna/nas-path";

export const NasCopySettingsContext = createContext<NasPathSettings | undefined>(undefined);

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
    <div className="shrink-0">
      <button
        type="button"
        aria-label={`${label} 폴더 경로 복사`}
        title={`${label}: ${path}`}
        className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-[#e4e7e1] bg-white px-1.5 text-[11px] font-medium text-[#315e49] hover:bg-[#e8f0e9]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void writeClipboard(path).then((ok) => {
            if (!ok) {
              onCopyToast?.(`복사하지 못했습니다: ${path}`);
              return;
            }
            setCopied(true);
            onCopyToast?.(COPY_TOAST);
          });
        }}
      >
        {copied ? <Check size={16} aria-hidden /> : label === "Rai" ? <HardDrive size={16} aria-hidden /> : <Folder size={16} aria-hidden />}
        <span>{copied ? "복사됨" : label}</span>
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
  const settings = useContext(NasCopySettingsContext);
  if (!pair || (!pair.office && !pair.laptop && !unc)) return null;

  return (
    <div
      className={`flex shrink-0 flex-wrap gap-1 ${className ?? ""}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      <NasPathCopyLine
        label="Work"
        path={pair.office}
        onCopyToast={onCopyToast}
      />
      <NasPathCopyLine
        label="Rai"
        path={settings ? raiPathForOfficePath(pair.office, settings) : pair.laptop}
        onCopyToast={onCopyToast}
      />
      {unc ? (
        <NasPathCopyLine label="UNC" path={unc} onCopyToast={onCopyToast} />
      ) : null}
    </div>
  );
}
