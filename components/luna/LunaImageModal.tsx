"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LunaCard } from "@/lib/luna/tavily";
import type { ModalPathTab, NasPathSettings } from "@/lib/luna/nas-path-settings";
import { MODAL_PATH_TABS, modalFilePath } from "@/lib/luna/image-modal-path";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaImageModal({
  cards,
  index,
  onClose,
  onIndexChange,
  nasPathSettings,
  onCopyToast,
  favoritePaths,
  onFavoriteToggle,
  pathTab,
  onPathTabChange
}: {
  cards: LunaCard[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  favoritePaths: Set<string>;
  onFavoriteToggle: (path: string, favorited: boolean) => void;
  pathTab: ModalPathTab;
  onPathTabChange: (tab: ModalPathTab) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [listIndex, setListIndex] = useState(index);
  const [detachedCard, setDetachedCard] = useState<LunaCard | null>(null);
  const [related, setRelated] = useState<LunaCard[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [imgFailed, setImgFailed] = useState(false);

  const displayCard = detachedCard ?? cards[listIndex] ?? cards[0];
  const total = cards.length;
  const favorited = displayCard?.raw_path
    ? favoritePaths.has(displayCard.raw_path)
    : false;

  const largeSrc =
    displayCard?.url?.trim() || displayCard?.thumbnail?.trim() || "";

  const descriptionText =
    displayCard?.image_description?.trim() ||
    displayCard?.description?.split(" · ")[0]?.trim() ||
    "";

  const filePath = useMemo(
    () => (displayCard ? modalFilePath(displayCard, pathTab, nasPathSettings) : ""),
    [displayCard, pathTab, nasPathSettings]
  );

  const loadRelated = useCallback(async (path: string) => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(
        `/api/luna/media/related?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        related?: LunaCard[];
        chips?: string[];
      };
      setRelated(Array.isArray(json.related) ? json.related : []);
      setChips(Array.isArray(json.chips) ? json.chips : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setListIndex(index);
    setDetachedCard(null);
    setImgFailed(false);
  }, [index]);

  useEffect(() => {
    const path = displayCard?.raw_path;
    if (!path) {
      setRelated([]);
      setChips([]);
      return;
    }
    void loadRelated(path);
  }, [displayCard?.raw_path, loadRelated]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (total <= 0) return;
      setDetachedCard(null);
      const next = (listIndex + delta + total) % total;
      setListIndex(next);
      onIndexChange(next);
    },
    [listIndex, onIndexChange, total]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const openRelated = (card: LunaCard) => {
    setImgFailed(false);
    const idx = cards.findIndex((c) => c.raw_path === card.raw_path);
    if (idx >= 0) {
      setDetachedCard(null);
      setListIndex(idx);
      onIndexChange(idx);
    } else {
      setDetachedCard(card);
    }
  };

  if (!mounted || !displayCard) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(18,18,24,.62)] p-[18px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="이미지 상세"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_18px_52px_rgba(0,0,0,.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-[300px] shrink-0 bg-[#eceef1]">
          {largeSrc && !imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={largeSrc}
              alt=""
              className="h-full w-full object-contain"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[13px] text-[#6b6f76]">
              이미지를 불러올 수 없습니다
            </div>
          )}
          {total > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-3 top-1/2 flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-[14px] text-[#1c1d21] shadow-sm"
                onClick={() => go(-1)}
                aria-label="이전"
              >
                ‹
              </button>
              <button
                type="button"
                className="absolute right-3 top-1/2 flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-[14px] text-[#1c1d21] shadow-sm"
                onClick={() => go(1)}
                aria-label="다음"
              >
                ›
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="absolute right-3 top-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/92 text-[14px] shadow-sm"
            onClick={() => {
              if (!displayCard.raw_path) return;
              onFavoriteToggle(displayCard.raw_path, !favorited);
            }}
            aria-label={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
          >
            {favorited ? "♥" : "♡"}
          </button>
          {total > 0 ? (
            <span
              className="absolute bottom-2.5 right-3 rounded-xl bg-black/60 px-2.5 py-0.5 text-[10.5px] text-white"
            >
              {listIndex + 1} / {total}
            </span>
          ) : null}
        </div>

        <div className="overflow-y-auto px-[17px] py-[13px]">
          <div className="mb-1 text-[13.5px] font-bold text-[#1c1d21]">
            {displayCard.title}
          </div>
          {descriptionText ? (
            <div className="mb-2.5 text-[12px] leading-[1.75] text-[#2a2c31]">
              {descriptionText}
            </div>
          ) : null}

          <div className="mb-2.5 overflow-hidden rounded-[9px] border border-[#e7e8ec]">
            <div className="flex border-b border-[#eef0f3] bg-[#FAFAFB]">
              {MODAL_PATH_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`border-r border-[#eef0f3] px-[11px] py-1.5 text-[10.5px] ${
                    pathTab === tab.id
                      ? "bg-white font-bold text-[#3C3489]"
                      : "text-[#9aa0a8]"
                  }`}
                  onClick={() => onPathTabChange(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-start gap-2 px-[11px] py-2">
              <span
                className="min-w-0 flex-1 break-all font-mono text-[10px] leading-[1.55] text-[#6b6f76]"
              >
                {filePath || "—"}
              </span>
              {filePath ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-[#EEEDFE] px-2.5 py-1 text-[10.5px] font-semibold text-[#534AB7]"
                  onClick={() => {
                    void navigator.clipboard.writeText(filePath).then(() => {
                      onCopyToast?.("경로 복사됨");
                    });
                  }}
                >
                  복사
                </button>
              ) : null}
            </div>
          </div>

          {chips.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-[14px] border border-[#e7e8ec] px-2.5 py-1 text-[11px] text-[#6b6f76]"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}

          {related.length > 0 ? (
            <>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[12px] font-bold text-[#1c1d21]">
                  관련 이미지
                </span>
                <span className="text-[10.5px] text-[#9aa0a8]">
                  {related.length}장
                </span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {related.map((rc) => (
                  <button
                    key={rc.raw_path ?? rc.title}
                    type="button"
                    className="w-[96px] shrink-0 text-left"
                    onClick={() => openRelated(rc)}
                  >
                    <div className="aspect-[4/3] overflow-hidden rounded-md bg-[#eceef1]">
                      {rc.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={rc.thumbnail}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-[#9aa0a8]">
                      {rc.title}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-[#e7e8ec] bg-[#FBFBFC] px-[17px] py-2.5">
          <button
            type="button"
            className="rounded-[9px] border border-[#534AB7] bg-[#534AB7] px-3 py-1.5 text-[11.5px] font-semibold text-white"
            disabled
          >
            🔍 이미지로 더 탐색하기
          </button>
          <button
            type="button"
            className="rounded-[9px] border border-[#e7e8ec] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#33363c]"
            onClick={onClose}
          >
            닫기
          </button>
          <span className="ml-auto text-[10.5px] text-[#9aa0a8]">
            ← → 넘기기 · ESC 닫기
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}