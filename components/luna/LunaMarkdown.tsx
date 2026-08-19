"use client";

import { useMemo } from "react";
import { HighlightScope } from "@/components/glossary/HighlightPhrase";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import {
  NasDriveModeToggle,
  NotionResultCard,
  WorkserverPathCard
} from "@/components/luna/WorkserverPathCard";
import { composeLunaResultLayout } from "@/lib/luna/answer-render";
import type { LunaNasDriveMode } from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";

type LunaMarkdownProps = {
  content: string;
  className?: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  source?: string;
  highlightTerms?: boolean;
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

export function LunaMarkdown({
  content,
  className = "",
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  notionSources = null,
  cards = null,
  source = "luna-md",
  highlightTerms
}: LunaMarkdownProps) {
  const allowTerms = highlightTerms ?? source !== "stream";
  const layout = useMemo(
    () =>
      composeLunaResultLayout({
        raw: content,
        cards,
        notionSources
      }),
    [content, cards, notionSources]
  );

  if (!content.trim()) return null;

  const { lead, nasGroups, notionItems, body, assume } = layout;
  const hasNas = nasGroups.length > 0;
  const hasNotion = notionItems.length > 0;
  const showDriveToggle = hasNas;

  const inner = (
    <div
      className={`break-words ${className}`.trim()}
      data-luna-render={source}
      data-luna-paths={nasGroups.length}
      data-luna-assume={assume.length}
    >
      {lead || showDriveToggle ? (
        <div
          className={`flex items-start gap-3 ${
            hasNas || hasNotion || body ? "mb-4" : ""
          }`}
        >
          <div className="min-w-0 flex-1 [&_p]:mb-0">
            {lead ? (
              <SafeMarkdown content={lead} variant="luna" highlightTerms={allowTerms} />
            ) : null}
          </div>
          {showDriveToggle ? (
            <NasDriveModeToggle
              mode={nasDriveMode}
              onChange={onNasDriveModeChange}
            />
          ) : null}
        </div>
      ) : null}

      {hasNas ? (
        <div className="space-y-[18px]">
          {nasGroups.map((group, groupIndex) => (
            <WorkserverPathCard
              key={`${group.drive}-${group.folderRawPath}-${groupIndex}`}
              group={group}
              mode={nasDriveMode}
              onCopyToast={onCopyToast}
            />
          ))}
        </div>
      ) : null}

      {hasNotion ? (
        <div className={hasNas ? "mt-[18px]" : undefined}>
          <NotionResultCard sources={notionItems} />
        </div>
      ) : null}

      {body ? (
        <div className={hasNas || hasNotion ? "mt-[18px]" : undefined}>
          <SafeMarkdown content={body} variant="luna" highlightTerms={allowTerms} />
        </div>
      ) : null}

      <AssumeBlocks assumptions={assume} />
    </div>
  );

  if (!allowTerms) return inner;
  return <HighlightScope>{inner}</HighlightScope>;
}
