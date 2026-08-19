"use client";

import { useState } from "react";
import { youtubeThumbUrl } from "@/lib/wiki/media";

export function WikiYoutubeEmbed({
  id,
  title
}: {
  id: string;
  title: string;
}) {
  const [play, setPlay] = useState(false);
  const label = title.trim() || "YouTube";
  return (
    <div className="my-3 overflow-hidden rounded-[10px] border border-[#e7e8ec]">
      {play ? (
        <div className="relative aspect-video bg-black">
          <iframe
            title={label}
            src={`https://www.youtube.com/embed/${id}?autoplay=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPlay(true)}
          className="relative block w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubeThumbUrl(id)}
            alt={label}
            className="aspect-video w-full object-cover"
          />
          <span className="absolute inset-0 grid place-items-center bg-black/25">
            <span className="grid h-[34px] w-12 place-items-center rounded-[9px] bg-[rgba(255,0,0,.85)] text-[15px] text-white">
              ▶
            </span>
          </span>
        </button>
      )}
      <div className="flex items-center gap-2 bg-[#FBFBFC] px-[11px] py-2 text-[11px] text-[#6b6f76]">
        <span className="rounded px-1.5 py-px text-[9px] font-bold text-white" style={{ background: "#FF0000" }}>
          YouTube
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
    </div>
  );
}
