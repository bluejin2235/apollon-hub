"use client";

import { useState } from "react";
import { NasPathDualCopy } from "@/components/luna/NasPathDualCopy";
import {
  nasExplorerFolderPair,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import { imageCategoryBadge } from "@/lib/luna/luna-answer-ui";
import type { LunaCard } from "@/lib/luna/tavily";

function ImageCell({
  card,
  onCopyToast,
  onOpen,
  isFavorite
}: {
  card: LunaCard;
  onCopyToast?: (msg: string) => void;
  onOpen: () => void;
  isFavorite?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const badge = imageCategoryBadge(card.ai_category);
  const last = (card.raw_path ?? "").replace(/\//g, "\\").split("\\").pop() || "";
  const isFile =
    card.is_file === true ||
    (card.is_file !== false && /\.[a-z0-9]{1,8}$/i.test(last));
  const pair = card.raw_path
    ? nasExplorerFolderPair(card.drive, card.raw_path, isFile)
    : null;

  return (
    <div className="relative w-full bg-white text-left">
      <button
        type="button"
        aria-label={`${card.title} 이미지 열기`}
        className="group relative w-full"
        onClick={onOpen}
      >
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
          {isFavorite ? (
            <span
              className="absolute right-1.5 top-1.5 text-[11px] leading-none text-[#e05252]"
              aria-label="즐겨찾기"
            >
              ♥
            </span>
          ) : null}
        </div>
      </button>
      <div className="px-2 py-1.5">
        <div className="break-all text-[10px] font-semibold leading-snug text-[#1c1d21]">
          {card.description?.split(" · ")[0]?.trim() || card.title}
        </div>
        {pair ? (
          <NasPathDualCopy
            pair={pair}
            onCopyToast={onCopyToast}
            className="mt-1"
          />
        ) : null}
      </div>
    </div>
  );
}

export function LunaImageGrid({
  cards,
  onCopyToast,
  limit,
  onMoreClick,
  favoritePaths,
  onCellClick
}: {
  cards: LunaCard[];
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  limit?: number;
  onMoreClick?: () => void;
  favoritePaths?: Set<string>;
  onCellClick?: (index: number) => void;
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
        {shown.map((card, i) => (
          <ImageCell
            key={`${card.raw_path ?? card.title}`}
            card={card}
            onCopyToast={onCopyToast}
            onOpen={() => onCellClick?.(i)}
            isFavorite={
              card.raw_path ? favoritePaths?.has(card.raw_path) : false
            }
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

export function imageFilePath(card: LunaCard): string {
  if (!card.raw_path) return "";
  return nasExplorerFolderPair(card.drive, card.raw_path, true).office;
}
