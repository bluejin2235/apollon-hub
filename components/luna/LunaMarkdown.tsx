"use client";

import { useMemo } from "react";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import {
  NotionResultCard,
  WorkserverPathCard
} from "@/components/luna/WorkserverPathCard";
import {
  extractNotionPagesFromMarkdown,
  mergeNotionSources,
  parseLunaAnswer,
  stripNotionLinksFromMarkdown
} from "@/lib/luna/answer-render";
import type { LunaNasDriveMode, MarkdownSegment } from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";

type LunaMarkdownProps = {
  content: string;
  className?: string;
  nasDriveMode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
  notionSources?: NotionSource[] | null;
  source?: string;
};

function AssumeBlocks({ assumptions }: { assumptions: string[] }) {
  if (assumptions.length === 0) return null;
  return (
    <div className="mt-[18px] space-y-3">
      {assumptions.map((a, i) => (
        <div
          key={`${i}-${a.slice(0, 24)}`}
          className="border-l-2 border-[#E0C79B] py-0.5 pl-3 text-[12.5px] leading-[1.65] text-[#6b6f76]"
        >
          {a}
        </div>
      ))}
    </div>
  );
}

function renderSegments(
  segments: MarkdownSegment[],
  nasDriveMode: LunaNasDriveMode,
  onCopyToast?: (message: string) => void
) {
  return segments.map((seg, index) => {
    if (seg.type === "text") {
      if (!seg.value.trim()) return null;
      return (
        <SafeMarkdown
          key={`text-${index}`}
          content={seg.value}
          variant="luna"
        />
      );
    }

    if (seg.groups.length === 0) return null;

    return (
      <div key={`paths-${index}`} className="mt-4 space-y-[18px]">
        {seg.groups.map((group, groupIndex) => (
          <WorkserverPathCard
            key={`${group.drive}-${group.folderRawPath}-${groupIndex}`}
            group={group}
            mode={nasDriveMode}
            onCopyToast={onCopyToast}
          />
        ))}
      </div>
    );
  });
}

export function LunaMarkdown({
  content,
  className = "",
  nasDriveMode,
  onCopyToast,
  notionSources = null,
  source = "luna-md"
}: LunaMarkdownProps) {
  const parsed = useMemo(() => {
    const raw = parseLunaAnswer(content);
    const fromMd = extractNotionPagesFromMarkdown(raw.markdown);
    const pages = mergeNotionSources(notionSources, fromMd);
    const segments = raw.segments.map((seg) =>
      seg.type === "text"
        ? { ...seg, value: stripNotionLinksFromMarkdown(seg.value) }
        : seg
    );
    return { ...raw, segments, pages };
  }, [content, notionSources]);

  if (!content.trim()) return null;

  const { segments, assumptions, pages } = parsed;
  const hasContent = segments.some(
    (s) =>
      (s.type === "text" && s.value.trim()) ||
      (s.type === "paths" && s.groups.length > 0)
  );

  return (
    <div
      className={`break-words ${className}`.trim()}
      data-luna-render={source}
      data-luna-paths={segments.filter((s) => s.type === "paths").length}
      data-luna-assume={assumptions.length}
    >
      {hasContent
        ? renderSegments(segments, nasDriveMode, onCopyToast)
        : null}
      {pages.length > 0 ? (
        <div className="mt-[18px]">
          <NotionResultCard sources={pages} />
        </div>
      ) : null}
      <AssumeBlocks assumptions={assumptions} />
    </div>
  );
}
