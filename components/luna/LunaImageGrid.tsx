"use client";

import { useState } from "react";
import {
  formatNasFolderPath,
  normalizeRawNasPath,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import {
  imageCategoryBadge,
  imagePathCaption
} from "@/lib/luna/luna-answer-ui";
import type { LunaCard } from "@/lib/luna/tavily";

function ImageCell({
  card,
  nasPathSettings,
  onCopyToast
}: {
  card: LunaCard;
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const badge = imageCategoryBadge(card.ai_category);
  const folderPath = card.raw_path
    ? formatNasFolderPath(
        card.drive,
        card.raw_path,
        nasPathSettings,
        false
      ).replace(/\\+$/, "")
    : "";

  return (
    <div className="group relative bg-white">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#eceef1]">
        {card.thumbnail && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2a3550] to-[#4a6fa5] text-[11px] text-white/80">
            {card.title.slice(0, 2)}
          </div>
        )}
        {badge ? (
          <span
            className={`absolute left-1.5 top-1.5 rounded-[5px] px-[5px] py-0.5 text-[8px] font-bold text-white ${badge.className}`}
          >
            {badge.label}
          </span>
        ) : null}
        <div className="absolute inset-0 flex items-end gap-1 bg-[rgba(20,20,28,.7)] p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {card.thumbnail ? (
            <a
              href={card.thumbnail}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-[5px] bg-white/90 py-1 text-center text-[9.5px] font-semibold text-[#1c1d21]"
            >
              크게
            </a>
          ) : null}
          {folderPath ? (
            <button
              type="button"
              className="flex-1 rounded-[5px] bg-white/90 py-1 text-center text-[9.5px] font-semibold text-[#1c1d21]"
              onClick={() => {
                void navigator.clipboard.writeText(folderPath).then(() => {
                  onCopyToast?.("폴더 경로 복사됨");
                });
              }}
            >
              폴더
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-2 py-1.5">
        <div
          className="truncate text-[10px] font-semibold leading-snug text-[#1c1d21]"
          title={card.title}
        >
          {card.description?.split(" · ")[0]?.trim() || card.title}
        </div>
        <div
          className="mt-0.5 truncate text-[9px] text-[#9aa0a8]"
          title={card.raw_path}
        >
          {imagePathCaption(card.raw_path)}
        </div>
      </div>
    </div>
  );
}

export function LunaImageGrid({
  cards,
  nasPathSettings,
  onCopyToast,
  limit,
  onMoreClick
}: {
  cards: LunaCard[];
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  limit?: number;
  onMoreClick?: () => void;
}) {
  const max = limit ?? cards.length;
  const shown = cards.slice(0, max);
  const more = cards.length - shown.length;

  if (cards.length === 0) {
    return (
      <p className="text-[12px] text-[#9aa0a8]">관련 이미지가 없습니다.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e7e8ec] bg-[#eef0f3]">
      <div className="grid grid-cols-2 gap-px sm:grid-cols-4 lg:grid-cols-5">
        {shown.map((card) => (
          <ImageCell
            key={`${card.raw_path ?? card.title}`}
            card={card}
            nasPathSettings={nasPathSettings}
            onCopyToast={onCopyToast}
          />
        ))}
        {more > 0 && onMoreClick ? (
          <button
            type="button"
            onClick={onMoreClick}
            className="flex min-h-[80px] items-center justify-center bg-white text-[12px] font-semibold text-[#534AB7]"
          >
            +{more}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function imageFilePath(
  card: LunaCard,
  nasPathSettings: NasPathSettings
): string {
  if (!card.raw_path) return "";
  return formatNasFolderPath(
    card.drive,
    normalizeRawNasPath(card.raw_path),
    nasPathSettings,
    true
  );
}
