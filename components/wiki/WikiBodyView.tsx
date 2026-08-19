"use client";

import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { WikiYoutubeEmbed } from "@/components/wiki/WikiYoutubeEmbed";
import { parseWikiBody } from "@/lib/wiki/media";

export function WikiBodyView({ text }: { text: string }) {
  const blocks = parseWikiBody(text);
  if (blocks.length === 0) return null;
  return (
    <div className="text-[13px] leading-[1.9] text-[#2a2c31]">
      {blocks.map((b, i) => {
        if (b.type === "image") {
          return (
            <figure
              key={`img-${i}`}
              className="my-3 overflow-hidden rounded-[10px] border border-[#e7e8ec]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.url} alt={b.caption || ""} className="w-full object-cover" />
              {b.caption ? (
                <figcaption className="bg-[#FBFBFC] px-[11px] py-[7px] text-[10.5px] text-[#9aa0a8]">
                  {b.caption}
                </figcaption>
              ) : null}
            </figure>
          );
        }
        if (b.type === "youtube") {
          return <WikiYoutubeEmbed key={`yt-${i}`} id={b.id} title={b.title} />;
        }
        return (
          <WikiMdChunk key={`md-${i}`} text={b.text} />
        );
      })}
    </div>
  );
}

function WikiMdChunk({ text }: { text: string }) {
  return (
    <SafeMarkdown
      content={text}
      highlightTerms
      className="wiki-md text-[13px] leading-[1.9] text-[#2a2c31] [&_a[href^='http']]:text-[#534AB7] [&_a[target='_blank']]:after:ml-0.5 [&_a[target='_blank']]:after:text-[9px] [&_a[target='_blank']]:after:text-[#9aa0a8] [&_a[target='_blank']]:after:content-['↗']"
    />
  );
}
