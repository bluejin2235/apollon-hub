"use client";

import { NasPathDualCopy } from "@/components/luna/NasPathDualCopy";
import {
  nasExplorerFolderPair,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import type { SourcePackItem } from "@/lib/luna/source-pack";

function DocBadges({ item }: { item: SourcePackItem }) {
  return (
    <div className="flex shrink-0 gap-1">
      {item.workStage === "executed" ? (
        <span className="rounded-[5px] bg-[#E6F5EF] px-1.5 py-0.5 text-[9px] font-bold text-[#0F6E56]">
          수행
        </span>
      ) : null}
      {item.workStage === "proposal" ? (
        <span className="rounded-[5px] bg-[#FBF3E6] px-1.5 py-0.5 text-[9px] font-bold text-[#9A6700]">
          제안
        </span>
      ) : null}
      {item.notion ? (
        <span className="rounded-[5px] bg-[#EFEFED] px-1.5 py-0.5 text-[9px] font-bold text-[#37352F]">
          노션
        </span>
      ) : null}
      {item.files.length > 0 || item.folder ? (
        <span className="rounded-[5px] bg-[#EDEFF2] px-1.5 py-0.5 text-[9px] font-bold text-[#5B6472]">
          워크
        </span>
      ) : null}
    </div>
  );
}

function folderPairOf(item: SourcePackItem) {
  if (item.folder) {
    return nasExplorerFolderPair(item.folder.drive, item.folder.rawPath, false);
  }
  const f = item.files[0];
  if (f) {
    return nasExplorerFolderPair(f.drive, f.rawPath, true);
  }
  return null;
}

export function LunaDocumentRow({
  item,
  onCopyToast
}: {
  item: SourcePackItem;
  nasPathSettings?: NasPathSettings;
  onCopyToast?: (msg: string) => void;
}) {
  const pair = folderPairOf(item);
  const href = item.notion?.url;
  const inner = (
    <>
      <span className="text-[13px] opacity-60">📄</span>
      <div className="min-w-0 flex-1">
        <div className="break-all text-[12.5px] font-semibold text-[#1c1d21]">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.title}
            </a>
          ) : item.title}
        </div>
        {pair ? (
          <NasPathDualCopy
            pair={pair}
            onCopyToast={onCopyToast}
            className="mt-1"
          />
        ) : (
          <div className="mt-0.5 break-all font-mono text-[10.5px] text-[#9aa0a8]">
            {item.subtitle}
          </div>
        )}
      </div>
      <DocBadges item={item} />
    </>
  );
  const className =
    "mb-1.5 flex items-start gap-2.5 rounded-[10px] border border-[#e7e8ec] px-3 py-2.5 hover:bg-[#FBFAFF]";

  return <div className={`${className} w-full text-left`}>{inner}</div>;
}

export function LunaDocumentList({
  items,
  nasPathSettings,
  onCopyToast,
  limit
}: {
  items: SourcePackItem[];
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    return <p className="text-[12px] text-[#9aa0a8]">관련 문서가 없습니다.</p>;
  }
  return (
    <>
      {shown.map((item) => (
        <LunaDocumentRow
          key={item.id}
          item={item}
          nasPathSettings={nasPathSettings}
          onCopyToast={onCopyToast}
        />
      ))}
    </>
  );
}

export function LunaSectionHeader({
  title,
  moreLabel,
  onMore
}: {
  title: string;
  moreLabel?: string;
  onMore?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[12px] font-bold text-[#1c1d21]">{title}</span>
      <span className="flex-1" />
      {moreLabel && onMore ? (
        <button
          type="button"
          onClick={onMore}
          className="text-[11px] font-semibold text-[#534AB7]"
        >
          {moreLabel}
        </button>
      ) : null}
    </div>
  );
}
