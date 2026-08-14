"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Folder } from "lucide-react";
import type { NotionSource } from "@/lib/luna/notion";
import type {
  FileExtBadgeKind,
  LunaNasDriveMode,
  WorkserverPathGroup
} from "@/lib/luna/nas-path";
import {
  fileExtBadgeKind,
  formatNasFolderBreadcrumb,
  formatNasFolderPath,
  inferFileTag,
  stripFileExtension
} from "@/lib/luna/nas-path";

const EXT_BADGE_STYLE: Record<FileExtBadgeKind, { color: string; border: string }> = {
  PPT: { color: "#B0552F", border: "#E8CFC2" },
  XLS: { color: "#2F7A57", border: "#C4E0D2" },
  PDF: { color: "#A83A3A", border: "#E8C9C9" },
  DOC: { color: "#3B6396", border: "#C7D5E8" },
  DWG: { color: "#7A6A45", border: "#DED5C1" },
  IMG: { color: "#6B5AA8", border: "#D3CCE8" },
  VID: { color: "#5A5A57", border: "#D6D5D0" },
  FILE: { color: "#8A8A85", border: "#DEDDD8" }
};

function FileExtBadge({ fileName }: { fileName: string }) {
  const kind = fileExtBadgeKind(fileName);
  const style = EXT_BADGE_STYLE[kind];
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded px-[5px] py-0.5 text-[9px] font-semibold tracking-[0.2px]"
      style={{ color: style.color, border: `1px solid ${style.border}` }}
    >
      {kind}
    </span>
  );
}

export function NasDriveModeFooter({
  driveLetter,
  mode,
  onChange
}: {
  driveLetter?: string;
  mode: LunaNasDriveMode;
  onChange?: (mode: LunaNasDriveMode) => void;
}) {
  const letter = (driveLetter ?? "T").replace(/:$/, "").toUpperCase() || "T";
  const item = (value: LunaNasDriveMode, label: string) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onChange?.(value);
        }}
        className="text-[11px]"
        style={{
          color: selected ? "#1c1d21" : "#9aa0a8",
          borderBottom: selected ? "1px solid #9aa0a8" : "1px solid transparent",
          paddingBottom: 1,
          fontWeight: selected ? 600 : 400
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mt-3 flex items-center gap-3.5 pl-0.5">
      <span className="text-[11px] text-[#9aa0a8]">{letter} 드라이브</span>
      <span className="text-[11px] text-[#9aa0a8]" aria-hidden>
        ·
      </span>
      {item("office", "사무실")}
      {item("raidrive", "RaiDrive")}
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
  onCopyToast?: (message: string) => void;
};

export function WorkserverPathCard({
  group,
  mode,
  onCopyToast
}: WorkserverPathCardProps) {
  const folderPath = formatNasFolderPath(
    group.drive,
    group.folderRawPath,
    mode,
    false
  );
  const crumb = formatNasFolderBreadcrumb(group.folderRawPath);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Folder
          className="h-[15px] w-[15px] shrink-0 text-[#9aa0a8]"
          strokeWidth={1.75}
          aria-hidden
        />
        <span
          className="min-w-0 flex-1 truncate text-[11.5px] text-[#6b6f76]"
          title={folderPath}
        >
          {crumb || folderPath}
        </span>
        <CopyButton
          text={folderPath}
          onCopyToast={onCopyToast}
          ariaLabel="폴더 경로 복사"
        />
      </div>

      {group.files.length > 0 ? (
        <div
          className="overflow-hidden rounded-[10px] bg-white"
          style={{ border: "1px solid #e7e8ec" }}
        >
          {group.files.map((fileName, index) => {
            const tag = inferFileTag(fileName);
            const isFinal = tag?.kind === "final";
            const isLast = index === group.files.length - 1;
            return (
              <div
                key={`${fileName}-${index}`}
                className="flex items-center gap-[11px] px-[14px] py-[11px]"
                style={{
                  borderBottom: isLast ? undefined : "1px solid #e7e8ec"
                }}
              >
                <FileExtBadge fileName={fileName} />
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{
                    color: isFinal ? "#1c1d21" : "#6b6f76",
                    fontWeight: isFinal ? 600 : 400
                  }}
                  title={fileName}
                >
                  {stripFileExtension(fileName)}
                </span>
                {tag ? (
                  <span
                    className="shrink-0 whitespace-nowrap text-[10.5px]"
                    style={{ color: isFinal ? "#0F6E56" : "#9aa0a8" }}
                  >
                    {tag.label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function NotionResultCard({ sources }: { sources: NotionSource[] }) {
  const pages = sources.filter((s) => s.title && s.url);
  if (pages.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="w-[15px] text-center text-[12px] font-semibold text-[#9aa0a8]">
          N
        </span>
        <span className="text-[11.5px] text-[#6b6f76]">노션</span>
      </div>
      <div
        className="overflow-hidden rounded-[10px] bg-white"
        style={{ border: "1px solid #e7e8ec" }}
      >
        {pages.map((page, index) => {
          const isLast = index === pages.length - 1;
          return (
            <a
              key={page.id || page.url}
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[11px] px-[14px] py-[11px] hover:bg-[#fafafa]"
              style={{
                borderBottom: isLast ? undefined : "1px solid #e7e8ec"
              }}
            >
              <span
                className="min-w-0 flex-1 truncate text-[13px] text-[#1c1d21]"
                title={page.title}
              >
                {page.title}
              </span>
              <ArrowUpRight
                className="h-[15px] w-[15px] shrink-0 text-[#9aa0a8]"
                strokeWidth={1.75}
                aria-hidden
              />
            </a>
          );
        })}
      </div>
    </div>
  );
}
