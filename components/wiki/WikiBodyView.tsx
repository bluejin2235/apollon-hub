"use client";

import { useEffect, useState } from "react";
import { WikiBodyMarkdown } from "@/components/wiki/WikiBodyMarkdown";
import { WikiYoutubeEmbed } from "@/components/wiki/WikiYoutubeEmbed";
import { parseWikiBody } from "@/lib/wiki/media";

export function WikiBodyView({ text }: { text: string }) {
  const blocks = parseWikiBody(text);
  if (blocks.length === 0) return null;
  return (
    <div className="text-[13px] leading-[1.9] text-[#2a2c31]">
      {blocks.map((b, i) => {
        if (b.type === "image") {
          return <WikiImage key={`img-${i}`} url={b.url} caption={b.caption} />;
        }
        if (b.type === "youtube") {
          return <WikiYoutubeEmbed key={`yt-${i}`} id={b.id} title={b.title} />;
        }
        return <WikiMdChunk key={`md-${i}`} text={b.text} />;
      })}
    </div>
  );
}

function WikiImage({ url, caption }: { url: string; caption: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <figure className="my-3 w-fit max-w-full overflow-hidden rounded-[10px] border border-[#e7e8ec]">
        <button
          type="button"
          className="block max-w-full cursor-zoom-in border-0 bg-transparent p-0"
          onClick={() => setOpen(true)}
          aria-label={caption ? `${caption} 크게 보기` : "이미지 크게 보기"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption || ""}
            className="block h-auto max-h-[70vh] max-w-full"
          />
        </button>
        {caption ? (
          <figcaption className="bg-[#FBFBFC] px-[11px] py-[7px] text-center text-[10.5px] text-[#9aa0a8]">
            {caption}
          </figcaption>
        ) : null}
      </figure>
      {open ? <WikiImageLightbox url={url} caption={caption} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 인라인 max-h 제한 없이 원본 크기로 본다. 뷰포트보다 크면 스크롤. */
function WikiImageLightbox({
  url,
  caption,
  onClose
}: {
  url: string;
  caption: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] overflow-auto bg-black/88 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 원본 보기"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="닫기"
        className="fixed right-4 top-4 z-[90] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="flex min-h-full min-w-full items-center justify-center p-6" onClick={onClose}>
        <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption || ""}
            className="h-auto max-w-[min(100%,95vw)] shadow-2xl"
          />
          {caption ? (
            <p className="mt-3 max-w-[90vw] text-center text-sm text-white/80">{caption}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WikiMdChunk({ text }: { text: string }) {
  return <WikiBodyMarkdown text={text} highlightTerms />;
}
