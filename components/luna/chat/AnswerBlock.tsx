"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import type { LunaAttachmentRef } from "@/components/luna/LunaInput";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { LunaMarkdown } from "@/components/luna/LunaMarkdown";
import { SupplyToast } from "@/components/supplies/toast";
import { LunaImageModal } from "@/components/luna/LunaImageModal";
import { LunaImageScopeNotice } from "@/components/luna/LunaImageScopeNotice";
import { ProgressSteps } from "@/components/luna/chat/ProgressSteps";
import { FoundPrompt } from "@/components/luna/chat/FoundPrompt";
import {
  NotFoundGuide,
  shouldShowNotFoundGuide
} from "@/components/luna/chat/NotFoundGuide";
import { looksPre2020 } from "@/components/luna/chat/LimitsDisclosure";
import { AnswerMeta } from "@/components/luna/chat/AnswerMeta";
import {
  SourceGroupSections,
  WikiCompactCard,
  SOURCE_PREVIEW_LIMIT
} from "@/components/luna/chat/SourceGroup";
import {
  isAnswerComplete,
  resolveAnswerMode,
  shouldShowImageChrome,
  splitSources,
  type AnswerMode
} from "@/components/luna/chat/answer-layout";
import type {
  LunaAnalysisTeam,
  LunaClarifyData,
  LunaDetailMeta,
  LunaModelStep,
  LunaProgressStep,
  LunaSourceReasons
} from "@/components/luna/LunaMessage";
import {
  DEFAULT_NAS_PATH_SETTINGS,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import type { ModalPathTab } from "@/lib/luna/nas-path-settings";
import {
  parseAssumeMarkers,
  scrubLunaAnswerText,
  type LunaClassificationMeta,
  type UsedPromptRef
} from "@/lib/luna/chat-response";
import { resolveSearchCounts } from "@/lib/luna/luna-answer-ui";
import type { LunaSearchCounts } from "@/lib/luna/luna-answer-ui";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import type { FeedbackReason } from "@/lib/luna/feedback";
import { supabase } from "@/lib/supabase/client";

const LUNA_BUBBLE_CLASS =
  "luna-term-on-bubble rounded-[6px_18px_18px_18px] border border-[#E8E5F4] bg-[#F7F6FC] px-5 py-[18px] text-[14.5px] leading-[1.7] text-[#1c1d21] max-md:px-4 max-md:py-4 max-md:text-[13.5px] max-md:leading-[1.7]";

export type AnswerBlockProps = {
  id: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  feedback?: "good" | "bad" | null;
  feedbackReason?: FeedbackReason | null;
  feedbackNote?: string | null;
  notionSources?: NotionSource[] | null;
  wikiSources?: WikiSourceRef[] | null;
  privateWikiRefs?: WikiSourceRef[] | null;
  cards?: LunaCard[] | null;
  searchCounts?: LunaSearchCounts | null;
  sourceReasons?: LunaSourceReasons | null;
  queryHint?: string | null;
  questionText?: string | null;
  nasPathSettings?: NasPathSettings;
  attachments?: LunaAttachmentRef[] | null;
  isThinking?: boolean;
  modelLabel?: string | null;
  durationMs?: number | null;
  modelSteps?: LunaModelStep[] | null;
  steps?: LunaProgressStep[] | null;
  clarify?: LunaClarifyData | null;
  mode?: "analysis" | null;
  teams?: LunaAnalysisTeam[] | null;
  onClarifySelect?: (option: string) => void;
  hideInlineClarifyOptions?: boolean;
  memoryCount?: number | null;
  correctionCandidateIds?: string[] | null;
  onCorrectionCancel?: (candidateId: string) => void;
  usedPrompts?: UsedPromptRef[] | null;
  classification?: LunaClassificationMeta | null;
  detailMeta?: LunaDetailMeta | null;
  intentScore?: number | null;
  confidenceScore?: number | null;
  selfNote?: string | null;
  showAnswerScores?: boolean;
};

function LunaAvatar() {
  return (
    <div
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-[12px] font-bold text-[#EEEDFE] max-md:h-6 max-md:w-6 max-md:text-[10.5px]"
      aria-hidden
    >
      L
    </div>
  );
}

export function UserBubble({
  content,
  engine,
  attachments
}: {
  content: string;
  engine?: string | null;
  attachments?: LunaAttachmentRef[] | null;
}) {
  const attachmentList = (attachments ?? []).filter((a) => a.file_name);
  return (
    <div className="mb-[22px] flex justify-end px-4 max-md:mb-3">
      <div className="max-w-[75%] max-md:max-w-[80%]">
        {attachmentList.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1">
            {attachmentList.map((att) => {
              const isPdf = att.mime_type === "application/pdf";
              const Icon = isPdf ? FileText : ImageIcon;
              return (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] text-white/90"
                >
                  <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="max-w-[160px] truncate">{att.file_name}</span>
                </span>
              );
            })}
          </div>
        ) : null}
        {content ? (
          <div className="whitespace-pre-wrap break-words rounded-[16px_16px_5px_16px] bg-[#534AB7] px-[15px] py-[11px] text-[14px] leading-[1.6] text-white max-md:px-[13px] max-md:py-[9px] max-md:text-[13.5px]">
            {content}
            {engine ? (
              <div className="mt-1.5 text-[10px] text-white/70">{engine}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssumptionBoxes({ assumptions }: { assumptions: string[] }) {
  if (assumptions.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {assumptions.map((a, i) => (
        <div
          key={`${i}-${a.slice(0, 24)}`}
          className="rounded-lg border border-[#F0DDB8] bg-[#FAEEDA] px-[11px] py-[9px] text-[13px] leading-[1.6] text-[#633806]"
        >
          {a}
        </div>
      ))}
    </div>
  );
}

function AnswerBodyMarkdown({
  body,
  streaming
}: {
  body: string;
  streaming?: boolean;
}) {
  return (
    <div className="text-[14.5px] leading-[1.75] text-[#1c1d21] max-md:text-[13.5px]">
      {body.trim() ? (
        <SafeMarkdown
          content={body}
          compact
          variant="luna"
          highlightTerms
          className="text-[14.5px] max-md:text-[13.5px]"
        />
      ) : streaming ? (
        <span className="inline-block h-[15px] w-0.5 animate-pulse bg-[#534AB7] align-text-bottom" />
      ) : null}
      {streaming && body.trim() ? (
        <span
          className="ml-0.5 inline-block h-[15px] w-[7px] animate-pulse bg-[#534AB7] align-text-bottom"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

type NasPathSettingsWithModal = NasPathSettings & {
  modalPathTab?: ModalPathTab | null;
};

function modalPathTabFromSettings(settings: NasPathSettings): ModalPathTab {
  return (settings as NasPathSettingsWithModal).modalPathTab ?? "office";
}

export function AnswerBlock(props: AnswerBlockProps) {
  if (props.role === "user") {
    return (
      <UserBubble
        content={props.content}
        engine={props.engine}
        attachments={props.attachments}
      />
    );
  }

  return <AssistantAnswerBlock {...props} />;
}

function AssistantAnswerBlock({
  id,
  content,
  feedback: initialFeedback = null,
  feedbackReason: initialReason = null,
  feedbackNote: initialNote = null,
  notionSources = null,
  wikiSources = null,
  privateWikiRefs = null,
  cards = null,
  searchCounts = null,
  queryHint = null,
  questionText = null,
  nasPathSettings = DEFAULT_NAS_PATH_SETTINGS,
  isThinking = false,
  modelLabel = null,
  durationMs = null,
  modelSteps = null,
  steps = null,
  clarify = null,
  mode = null,
  teams = null,
  memoryCount = null,
  correctionCandidateIds = null,
  onCorrectionCancel,
  usedPrompts = null,
  classification = null,
  detailMeta = null,
  intentScore = null,
  confidenceScore = null,
  selfNote = null,
  showAnswerScores = false,
  hideInlineClarifyOptions = false,
  onClarifySelect
}: AnswerBlockProps) {
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [favoritePaths, setFavoritePaths] = useState<Set<string>>(new Set());
  const [pathTab, setPathTab] = useState<ModalPathTab>(() =>
    modalPathTabFromSettings(nasPathSettings)
  );
  const [dismissedChips, setDismissedChips] = useState<string[]>([]);

  const sources = useMemo(
    () => notionSources?.filter((s) => s.title && s.url) ?? [],
    [notionSources]
  );
  const wikiRefs = useMemo(() => wikiSources ?? [], [wikiSources]);
  const privateRefs = useMemo(() => privateWikiRefs ?? [], [privateWikiRefs]);
  const cardList = useMemo(
    () => (cards ?? []).filter((c) => c.title),
    [cards]
  );
  const stepList = steps ?? [];
  const teamList = teams ?? [];
  const isAnalysis = mode === "analysis" || teamList.length > 0;

  const mergedDetailMeta: LunaDetailMeta = {
    modelSteps: detailMeta?.modelSteps ?? modelSteps,
    steps: detailMeta?.steps ?? stepList,
    wsSearches: detailMeta?.wsSearches ?? null,
    connectorRouting: detailMeta?.connectorRouting ?? null,
    timings: detailMeta?.timings ?? null,
    classificationLabel: detailMeta?.classificationLabel ?? null,
    classifySource: detailMeta?.classifySource ?? null,
    keywords: detailMeta?.keywords ?? null
  };

  const scrubbed = useMemo(() => scrubLunaAnswerText(content), [content]);
  const { body, assumptions } = useMemo(
    () => parseAssumeMarkers(scrubbed),
    [scrubbed]
  );

  const answerMode: AnswerMode = useMemo(
    () =>
      resolveAnswerMode({
        classification,
        questionText,
        steps: stepList
      }),
    [classification, questionText, stepList]
  );

  const split = useMemo(
    () =>
      splitSources({
        notionSources: sources,
        wikiSources: wikiRefs,
        cards: cardList
      }),
    [sources, wikiRefs, cardList]
  );

  const searchDone = stepList.some(
    (s) => s.key === "search" && s.status === "done"
  );
  const hasSnapshot = cards != null || searchCounts != null;
  const counts = useMemo(
    () =>
      resolveSearchCounts({
        snapshot: searchCounts,
        notionSources: sources,
        wikiSources: wikiRefs,
        cards: cardList,
        searchDone: searchDone || hasSnapshot
      }),
    [searchCounts, sources, wikiRefs, cardList, searchDone, hasSnapshot]
  );

  const isComplete = isAnswerComplete({ isThinking, content: scrubbed });
  const forceProgressOpen = isThinking || !isComplete;
  const streaming = isThinking || (!isComplete && Boolean(body.trim()));

  const imageChrome = shouldShowImageChrome(answerMode, questionText);
  const canFeedback =
    Boolean(id) && !id.startsWith("temp-") && !isThinking;

  const showDocsTab =
    !isThinking &&
    (answerMode === "project" ||
      answerMode === "default" ||
      answerMode === "reference") &&
    (split.notion.length > SOURCE_PREVIEW_LIMIT ||
      split.work.length > SOURCE_PREVIEW_LIMIT ||
      split.wiki.length > SOURCE_PREVIEW_LIMIT ||
      (imageChrome && split.image.length > 8));

  useEffect(() => {
    setPathTab(modalPathTabFromSettings(nasPathSettings));
  }, [nasPathSettings]);

  useEffect(() => {
    async function loadFavorites() {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/luna/media/favorites", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const json = (await res.json()) as { paths?: string[] };
        if (Array.isArray(json.paths)) setFavoritePaths(new Set(json.paths));
      } catch {
        /* ignore */
      }
    }
    void loadFavorites();
  }, []);

  const toggleFavorite = useCallback(async (path: string, favorited: boolean) => {
    setFavoritePaths((prev) => {
      const next = new Set(prev);
      if (favorited) next.add(path);
      else next.delete(path);
      return next;
    });
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    try {
      await fetch("/api/luna/media/favorites", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path, favorited })
      });
    } catch {
      /* ignore */
    }
  }, []);

  async function cancelCorrection(candidateId: string) {
    setDismissedChips((prev) => [...prev, candidateId]);
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch("/api/luna/candidates/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: candidateId, action: "reject" })
      });
      if (!res.ok) console.error("[luna] cancel correction", await res.text());
      onCorrectionCancel?.(candidateId);
    } catch (err) {
      console.error("[luna] cancel correction", err);
    }
  }

  const visibleCorrectionIds = (correctionCandidateIds ?? []).filter(
    (cid) => !dismissedChips.includes(cid)
  );

  let bubbleInner: ReactNode;

  if (clarify) {
    const q = clarify.question || content;
    bubbleInner = (
      <div className="space-y-2">
        <SafeMarkdown
          content={q}
          className="text-[14.5px] leading-[1.75] text-[#1c1d21]"
          highlightTerms
        />
        {!hideInlineClarifyOptions &&
        Array.isArray(clarify.options) &&
        clarify.options.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clarify.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onClarifySelect?.(opt)}
                className="rounded-full border border-[#E3E0F5] bg-white px-3 py-1 text-[12px] text-[#534AB7] hover:bg-[#F7F6FC]"
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  } else if (isAnalysis) {
    bubbleInner = (
      <LunaMarkdown
        content={scrubbed}
        className="text-sm leading-relaxed text-slate-900"
        nasPathSettings={nasPathSettings}
        onCopyToast={setCopyToast}
        notionSources={sources}
        cards={cardList}
        source="analysis"
      />
    );
  } else {
    const showProgress =
      forceProgressOpen ||
      stepList.filter((s) => s.status !== "skip").length > 0 ||
      isThinking;

    const termLike = answerMode === "term" || answerMode === "policy";
    const wikiLimit = termLike ? 3 : split.wiki.length;

    bubbleInner = (
      <>
        {showProgress ? (
          <ProgressSteps
            steps={stepList}
            classification={classification}
            counts={counts}
            isComplete={isComplete}
            forceExpanded={forceProgressOpen}
          />
        ) : null}
        <AnswerBodyMarkdown body={body} streaming={streaming} />
        <AssumptionBoxes assumptions={assumptions} />
        {shouldShowNotFoundGuide({
          content: scrubbed,
          isComplete,
          isThinking,
          counts
        }) ? (
          <NotFoundGuide
            content={scrubbed}
            questionText={questionText}
            steps={stepList}
            classification={classification}
            counts={counts}
            cards={cardList}
            nasPathSettings={nasPathSettings}
            onCopyToast={setCopyToast}
          />
        ) : null}
        {!isThinking &&
        isComplete &&
        looksPre2020(`${questionText ?? ""}\n${scrubbed}`) ? (
          <p className="mt-2.5 text-[12px] leading-[1.55] text-[#9aa0a8]">
            오래된 자료라 놓친 게 있을 수 있어요
          </p>
        ) : null}
        {termLike ? (
          <div className="mt-3 space-y-2">
            {split.wiki.slice(0, wikiLimit).map((w) => (
              <WikiCompactCard key={`${w.slug}:${w.section_id}`} src={w} />
            ))}
          </div>
        ) : null}
        {answerMode === "reference" ? (
          <>
            <SourceGroupSections
              sources={split}
              nasPathSettings={nasPathSettings}
              onCopyToast={setCopyToast}
              showNotion={split.notion.length > 0}
              showWork={split.work.length > 0}
              showWiki={split.wiki.length > 0}
              showImage
              imageLimit={docsExpanded ? undefined : 8}
              previewLimit={docsExpanded ? undefined : SOURCE_PREVIEW_LIMIT}
              emptyImageHint={
                split.image.length === 0
                  ? "관련 이미지는 아직 색인이 적어 못 찾았어요. 문서 위주로 골랐습니다."
                  : null
              }
              onImageCellClick={setModalIndex}
              favoritePaths={favoritePaths}
            />
            {imageChrome ? (
              <LunaImageScopeNotice onCopyToast={setCopyToast} />
            ) : null}
          </>
        ) : null}
        {(answerMode === "project" || answerMode === "default") &&
        (split.notion.length > 0 ||
          split.work.length > 0 ||
          split.wiki.length > 0 ||
          (imageChrome && split.image.length > 0)) ? (
          <SourceGroupSections
            sources={split}
            nasPathSettings={nasPathSettings}
            onCopyToast={setCopyToast}
            showNotion={split.notion.length > 0}
            showWork={split.work.length > 0}
            showWiki={split.wiki.length > 0}
            showImage={imageChrome && split.image.length > 0}
            previewLimit={docsExpanded ? undefined : SOURCE_PREVIEW_LIMIT}
            onImageCellClick={setModalIndex}
            favoritePaths={favoritePaths}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="group mb-[22px] flex items-start gap-2.5 px-4 max-md:mb-4">
      <LunaAvatar />
      <div className="min-w-0 flex-1">
        {bubbleInner ? (
          isAnalysis && !isThinking ? (
            bubbleInner
          ) : (
            <div className={LUNA_BUBBLE_CLASS}>{bubbleInner}</div>
          )
        ) : null}

        {!isThinking && !clarify && scrubbed.trim() ? (
          <FoundPrompt messageId={id} canSubmit={canFeedback} />
        ) : null}

        {!isThinking && !clarify ? (
          <AnswerMeta
            messageId={id}
            content={scrubbed}
            cards={cardList}
            notionSources={sources}
            wikiSources={wikiRefs}
            privateWikiRefs={privateRefs}
            memoryCount={memoryCount ?? 0}
            canFeedback={canFeedback}
            initialFeedback={initialFeedback}
            initialReason={initialReason}
            initialNote={initialNote}
            modelLabel={modelLabel}
            durationMs={durationMs}
            detailMeta={mergedDetailMeta}
            usedPrompts={usedPrompts}
            classification={classification}
            intentScore={intentScore}
            confidenceScore={confidenceScore}
            selfNote={selfNote}
            showAnswerScores={showAnswerScores}
            docsTabLabel={
              showDocsTab && !docsExpanded ? "문서 탭 →" : null
            }
            onDocsTab={
              showDocsTab && !docsExpanded
                ? () => setDocsExpanded(true)
                : undefined
            }
          />
        ) : null}

        {visibleCorrectionIds.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {visibleCorrectionIds.map((cid) => (
              <div
                key={cid}
                className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-900"
              >
                <span>🌱 방금 정정을 배움 후보로 올렸어요</span>
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => void cancelCorrection(cid)}
                >
                  · 취소
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {modalIndex != null && split.image.length > 0 ? (
        <LunaImageModal
          cards={split.image}
          index={modalIndex}
          onClose={() => setModalIndex(null)}
          onIndexChange={setModalIndex}
          nasPathSettings={nasPathSettings}
          onCopyToast={setCopyToast}
          favoritePaths={favoritePaths}
          onFavoriteToggle={toggleFavorite}
          pathTab={pathTab}
          onPathTabChange={setPathTab}
        />
      ) : null}
      <SupplyToast message={copyToast} onClose={() => setCopyToast(null)} />
    </div>
  );
}
