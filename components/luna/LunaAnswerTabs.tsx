"use client";

import type { LunaAnswerTab } from "@/lib/luna/luna-answer-ui";
import { showVideoTab } from "@/lib/luna/luna-answer-ui";

function TabCount({ n, pending }: { n: number | null; pending?: boolean }) {
  if (pending || n == null) {
    return <span className="text-[10.5px] opacity-70">…</span>;
  }
  return <span className="text-[10.5px] opacity-70">{n}</span>;
}

export function LunaAnswerTabs({
  tab,
  onTabChange,
  docCount,
  imageCount,
  docPending,
  imagePending
}: {
  tab: LunaAnswerTab;
  onTabChange: (tab: LunaAnswerTab) => void;
  docCount: number | null;
  imageCount: number | null;
  docPending?: boolean;
  imagePending?: boolean;
}) {
  const videoVisible = showVideoTab(imageCount);
  const tabClass = (active: boolean, dim?: boolean) =>
    `flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-[12.5px] ${
      active
        ? "border-[#534AB7] font-bold text-[#3C3489]"
        : `border-transparent ${dim ? "text-[#9aa0a8]" : "text-[#6b6f76]"}`
    }`;

  return (
    <div className="mb-3 flex gap-0.5 border-b border-[#e7e8ec]">
      <button
        type="button"
        className={tabClass(tab === "all")}
        onClick={() => onTabChange("all")}
      >
        전체
      </button>
      <button
        type="button"
        className={tabClass(tab === "docs", docPending && docCount == null)}
        onClick={() => onTabChange("docs")}
      >
        문서 <TabCount n={docCount} pending={docPending && docCount == null} />
      </button>
      <button
        type="button"
        className={tabClass(tab === "images", imagePending && imageCount == null)}
        onClick={() => onTabChange("images")}
      >
        이미지{" "}
        <TabCount n={imageCount} pending={imagePending && imageCount == null} />
      </button>
      {videoVisible ? (
        <button
          type="button"
          className={tabClass(tab === "video", true)}
          onClick={() => onTabChange("video")}
        >
          영상 <TabCount n={0} pending />
        </button>
      ) : null}
    </div>
  );
}
