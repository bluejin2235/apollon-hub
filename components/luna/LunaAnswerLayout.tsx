"use client";

import { useMemo, useState, type ReactNode } from "react";
import { LunaMarkdown } from "@/components/luna/LunaMarkdown";
import { SourcePackList } from "@/components/luna/SourcePackCard";
import { LunaAnswerTabs } from "@/components/luna/LunaAnswerTabs";
import { LunaSearchProgress } from "@/components/luna/LunaSearchProgress";
import {
  LunaDocumentList,
  LunaSectionHeader
} from "@/components/luna/LunaDocumentList";
import { LunaImageGrid } from "@/components/luna/LunaImageGrid";
import {
  LunaImageIndexWarning,
  LunaImageScopeNotice
} from "@/components/luna/LunaImageScopeNotice";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import {
  buildDocPackItems,
  countDocMaterials,
  docCards,
  imageCards,
  resolveSearchCounts,
  showImageIndexWarning,
  type LunaAnswerTab,
  type LunaSearchCounts
} from "@/lib/luna/luna-answer-ui";
import type { NasPathSettings } from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";

export function LunaAnswerLayout({
  isStreaming,
  content,
  steps,
  classification,
  notionSources,
  wikiSources,
  cards,
  searchCounts,
  nasPathSettings,
  onCopyToast,
  queryHint,
  questionText
}: {
  isStreaming: boolean;
  content: string;
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  notionSources?: NotionSource[] | null;
  wikiSources?: WikiSourceRef[] | null;
  cards?: LunaCard[] | null;
  searchCounts?: LunaSearchCounts | null;
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  queryHint?: string | null;
  questionText?: string | null;
}) {
  const [tab, setTab] = useState<LunaAnswerTab>("all");
  const searchDone = steps.some(
    (s) => s.key === "search" && s.status === "done"
  );
  const hasSnapshot = cards != null || searchCounts != null;

  const counts = useMemo(
    () =>
      resolveSearchCounts({
        snapshot: searchCounts,
        notionSources,
        wikiSources,
        cards,
        searchDone: searchDone || hasSnapshot
      }),
    [
      searchCounts,
      notionSources,
      wikiSources,
      cards,
      searchDone,
      hasSnapshot
    ]
  );

  const imgs = useMemo(() => imageCards(cards), [cards]);
  const docItems = useMemo(
    () =>
      buildDocPackItems(notionSources, cards, questionText || queryHint),
    [notionSources, cards, questionText, queryHint]
  );
  const docCount = useMemo(
    () =>
      counts.wiki != null || searchDone || hasSnapshot
        ? countDocMaterials(notionSources, cards)
        : null,
    [counts, searchDone, hasSnapshot, notionSources, cards]
  );
  const imageCount =
    counts.image ?? (hasSnapshot || searchDone ? imgs.length : null);

  const showIndexWarn = showImageIndexWarning(
    questionText,
    imageCount ?? 0,
    docCount ?? 0
  );
  const nasHint =
    notionSources?.find((s) => s.nas_path)?.nas_path ??
    notionSources?.find((s) => s.paths?.[0])?.paths?.[0] ??
    null;

  const answerBlock = (
    <div className="text-[14.5px] leading-[1.85] text-[#2a2c31] max-md:text-[13.5px]">
      {content.trim() ? (
        <LunaMarkdown
          content={content}
          className="text-[14.5px] max-md:text-[13.5px]"
          nasPathSettings={nasPathSettings}
          onCopyToast={onCopyToast}
          notionSources={notionSources}
          cards={docCards(cards)}
          source={isStreaming ? "stream" : "complete-stream"}
          queryHint={queryHint}
          questionText={questionText}
          hideSourcePacks
        />
      ) : isStreaming ? (
        <span className="inline-block h-[15px] w-0.5 animate-pulse bg-[#534AB7] align-text-bottom" />
      ) : null}
      {isStreaming && content.trim() ? (
        <span
          className="ml-0.5 inline-block h-[15px] w-[7px] animate-pulse bg-[#534AB7] align-text-bottom"
          aria-hidden
        />
      ) : null}
    </div>
  );

  const docSection = (limit?: number) => (
    <section className={limit ? "mt-4" : ""}>
      <LunaSectionHeader
        title={`📄 자료${docCount != null ? ` ${docCount}건` : ""}`}
        moreLabel={limit && (docCount ?? 0) > limit ? "문서 탭 →" : undefined}
        onMore={limit ? () => setTab("docs") : undefined}
      />
      <LunaDocumentList
        items={docItems}
        nasPathSettings={nasPathSettings}
        onCopyToast={onCopyToast}
        limit={limit}
      />
    </section>
  );

  const imageSection = (limit?: number) =>
    imageCount === 0 && !isStreaming && searchDone ? null : (
      <section className="mt-4">
        <LunaSectionHeader
          title={`🖼 이미지${imageCount != null ? ` ${imageCount}장` : ""}`}
          moreLabel={
            limit && (imageCount ?? 0) > limit ? "이미지 탭 →" : undefined
          }
          onMore={limit ? () => setTab("images") : undefined}
        />
        {(imageCount ?? imgs.length) > 0 || isStreaming ? (
          <LunaImageGrid
            cards={imgs}
            nasPathSettings={nasPathSettings}
            onCopyToast={onCopyToast}
            limit={limit}
            onMoreClick={limit ? () => setTab("images") : undefined}
          />
        ) : null}
      </section>
    );

  let body: React.ReactNode;
  if (tab === "docs") {
    body = (
      <>
        {docItems.length > 0 ? (
          <SourcePackList
            notionSources={notionSources}
            cards={docCards(cards)}
            nasPathSettings={nasPathSettings}
            onCopyToast={onCopyToast}
            queryHint={queryHint}
            stageQuestion={questionText}
          />
        ) : (
          docSection()
        )}
      </>
    );
  } else if (tab === "images") {
    body = <LunaImageGrid cards={imgs} nasPathSettings={nasPathSettings} onCopyToast={onCopyToast} />;
  } else if (tab === "video") {
    body = (
      <p className="text-[12px] text-[#9aa0a8]">
        영상 색인은 준비 중입니다.
      </p>
    );
  } else {
    body = (
      <>
        {showIndexWarn ? (
          <LunaImageIndexWarning
            nasPath={nasHint}
            onCopyToast={onCopyToast}
          />
        ) : null}
        {answerBlock}
        {(docCount ?? 0) > 0 || (isStreaming && docCount == null)
          ? docSection(2)
          : null}
        {imageSection(5)}
        <LunaImageScopeNotice onCopyToast={onCopyToast} />
      </>
    );
  }

  return (
    <>
      <LunaAnswerTabs
        tab={tab}
        onTabChange={setTab}
        docCount={docCount}
        imageCount={imageCount}
        docPending={isStreaming && docCount == null}
        imagePending={isStreaming && imageCount == null}
      />
      <LunaSearchProgress
        steps={steps}
        classification={classification}
        counts={counts}
        isComplete={!isStreaming}
      />
      {tab === "all" ? body : <div className="mt-1">{body}</div>}
    </>
  );
}
