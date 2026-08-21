"use client";

import { useMemo } from "react";
import { HighlightScope } from "@/components/glossary/HighlightPhrase";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { NasDriveModeToggle } from "@/components/luna/WorkserverPathCard";
import { SourcePackList } from "@/components/luna/SourcePackCard";
import { composeLunaResultLayout } from "@/lib/luna/answer-render";
import { countSourcePackMaterialsFromMeta } from "@/lib/luna/source-pack";
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
  queryHint?: string | null;
  /** 직전 사용자 질문 전문 — 답변 본문 strip 깊이 판정 */
  questionText?: string | null;
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
  highlightTerms,
  queryHint = null,
  questionText = null
}: LunaMarkdownProps) {
  const allowTerms = highlightTerms ?? source !== "stream";
  const layout = useMemo(
    () =>
      composeLunaResultLayout({
        raw: content,
        cards,
        notionSources,
        questionText
      }),
    [content, cards, notionSources, questionText]
  );

  if (!content.trim()) return null;

  const { lead, nasGroups, notionItems, body, assume } = layout;
  const packNotion =
    (notionSources?.length ?? 0) > 0 ? notionSources : notionItems;
  const materials = countSourcePackMaterialsFromMeta(packNotion, cards);
  const hasPacks = materials > 0;
  const showDriveToggle = hasPacks || nasGroups.length > 0;

  const inner = (
    <div
      className={`break-words ${className}`.trim()}
      data-luna-render={source}
      data-luna-paths={nasGroups.length}
      data-luna-packs={materials}
      data-luna-assume={assume.length}
    >
      {lead || showDriveToggle ? (
        <div
          className={`flex items-start gap-3 ${
            hasPacks || body ? "mb-4" : ""
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

      {hasPacks ? (
        <SourcePackList
          notionSources={packNotion}
          cards={cards}
          nasDriveMode={nasDriveMode}
          onCopyToast={onCopyToast}
          queryHint={queryHint}
        />
      ) : null}

      {body ? (
        <div className={hasPacks ? "mt-[18px]" : undefined}>
          <SafeMarkdown content={body} variant="luna" highlightTerms={allowTerms} />
        </div>
      ) : null}

      <AssumeBlocks assumptions={assume} />
    </div>
  );

  if (!allowTerms) return inner;
  return <HighlightScope resetKey={content}>{inner}</HighlightScope>;
}
