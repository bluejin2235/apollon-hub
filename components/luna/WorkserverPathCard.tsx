"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { LunaNasDriveMode, WorkserverPathGroup } from "@/lib/luna/nas-path";
import { formatNasFilePath, formatNasFolderPath } from "@/lib/luna/nas-path";

export function NasDriveModeToggles({
  mode,
  onChange
}: {
  mode: LunaNasDriveMode;
  onChange?: (mode: LunaNasDriveMode) => void;
}) {
  const btn = (value: LunaNasDriveMode, label: string) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onChange?.(value);
        }}
        className="shrink-0 text-[10px]"
        style={{
          padding: "2px 7px",
          borderRadius: 10,
          backgroundColor: selected ? "#E1F5EE" : "transparent",
          border: selected ? "1px solid #0F6E56" : "1px solid #D3D1C7",
          color: selected ? "#04342C" : "#6B7280"
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {btn("office", "사무실")}
      {btn("raidrive", "RaiDrive")}
    </div>
  );
}

function CopyButton({
  text,
  onCopyToast,
  ariaLabel
}: {
  text: string;
  onCopyToast?: (message: string) => void;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        onCopyToast?.("복사했어요");
      },
      () => {
        /* ignore */
      }
    );
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        copy();
      }}
      className="shrink-0 text-[#9aa0a8] hover:text-[#6b6f76]"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2} style={{ color: "#0F6E56" }} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

type WorkserverPathCardProps = {
  group: WorkserverPathGroup;
  mode: LunaNasDriveMode;
  onModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
};

export function WorkserverPathCard({
  group,
  mode,
  onModeChange,
  onCopyToast
}: WorkserverPathCardProps) {
  const folderPath = formatNasFolderPath(
    group.drive,
    group.folderRawPath,
    mode,
    false
  );

  return (
    <div
      className="overflow-hidden rounded-lg bg-white"
      style={{ border: "0.5px solid #E3E0F5" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-[11px] py-[7px]"
        style={{ borderBottom: "0.5px solid #EEEDFE" }}
      >
        <span className="text-[10.5px] text-[#9aa0a8]">경로</span>
        <NasDriveModeToggles mode={mode} onChange={onModeChange} />
      </div>

      <div
        className="flex items-start gap-2 px-[11px] py-[8px]"
        style={{
          borderBottom: group.files.length > 0 ? "0.5px solid #EEEDFE" : undefined
        }}
      >
        <span className="mt-px w-[26px] shrink-0 text-[10px] text-[#9aa0a8]">폴더</span>
        <span className="min-w-0 flex-1 break-all font-mono text-[12px] leading-[1.6] text-[#1c1d21]">
          {folderPath}
        </span>
        <CopyButton
          text={folderPath}
          onCopyToast={onCopyToast}
          ariaLabel="폴더 경로 복사"
        />
      </div>

      {group.files.map((fileName, index) => {
        const filePath = formatNasFilePath(
          group.drive,
          group.folderRawPath,
          mode,
          fileName
        );
        const isLast = index === group.files.length - 1;
        return (
          <div
            key={fileName}
            className="flex items-start gap-2 px-[11px] py-[8px]"
            style={{ borderBottom: isLast ? undefined : "0.5px solid #EEEDFE" }}
          >
            <span className="mt-px w-[26px] shrink-0 text-[10px] text-[#9aa0a8]">파일</span>
            <span className="min-w-0 flex-1 break-all font-mono text-[12px] font-semibold leading-[1.6] text-[#1c1d21]">
              {fileName}
            </span>
            <CopyButton
              text={filePath}
              onCopyToast={onCopyToast}
              ariaLabel={`${fileName} 경로 복사`}
            />
          </div>
        );
      })}
    </div>
  );
}
