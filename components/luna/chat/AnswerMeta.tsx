"use client";

import { useEffect, useState } from "react";
import { Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import type { LunaDetailMeta } from "@/components/luna/LunaMessage";
import type { LunaCard } from "@/lib/luna/tavily";
import type { NotionSource } from "@/lib/luna/notion";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import {
  countSourceBadges,
  type LunaClassificationMeta,
  type UsedPromptRef
} from "@/lib/luna/chat-response";
import { countDocMaterials } from "@/lib/luna/luna-answer-ui";
import {
  buildDetailTimingRows,
  formatDetailSummaryLine
} from "@/lib/luna/progress-display";
import { summarizeUsedPrompts } from "@/lib/luna/used-prompts";
import {
  clipFeedbackNote,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_REASON_IDS,
  FEEDBACK_REASON_LABELS,
  isFeedbackReason,
  type FeedbackReason
} from "@/lib/luna/feedback";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function scoreTone(n: number | null | undefined): string {
  if (typeof n !== "number") return "text-[#6b6f76]";
  return n < 5 ? "font-bold text-[#B0782B]" : "font-semibold text-[#0F6E56]";
}

function SourceChips({
  cards,
  notionSources,
  wikiSources,
  privateWikiRefs,
  memoryCount
}: {
  cards: LunaCard[];
  notionSources: NotionSource[];
  wikiSources: WikiSourceRef[];
  privateWikiRefs: WikiSourceRef[];
  memoryCount: number;
}) {
  const counts = countSourceBadges({
    cards,
    notionSources,
    wikiSources,
    privateWikiRefs,
    memoryCount,
    materialsCount: countDocMaterials(notionSources, cards)
  });
  const chips: { label: string; n: number }[] = [];
  // 목업: 자료·위키·기억은 0이어도 칩으로 남긴다 (이미지 칩은 없음)
  chips.push({ label: "자료", n: counts.materials });
  chips.push({ label: "위키", n: counts.wiki });
  chips.push({ label: "기억", n: counts.memory });
  return (
    <>
      {chips.map((c) => (
        <span
          key={c.label}
          className="rounded-full border border-[#e7e8ec] bg-[#f1f2f5] px-2.5 py-0.5 text-[10.5px] text-[#6b6f76]"
        >
          {c.label} {c.n}
        </span>
      ))}
    </>
  );
}

function UsedPromptsLine({
  usedPrompts,
  classification
}: {
  usedPrompts: UsedPromptRef[];
  classification?: LunaClassificationMeta | null;
}) {
  const summary = summarizeUsedPrompts(usedPrompts);
  const typeLabel =
    classification?.labels?.length
      ? classification.labels.join("+")
      : classification?.types?.length
        ? classification.types.join("+")
        : "";
  if (summary.length === 0 && !typeLabel) return null;
  const desktopParts = summary.map((p) =>
    p.number ? `${p.number} ${p.title}` : p.title
  );
  return (
    <div className="mt-1.5 text-[10.5px] leading-[1.6] text-[#9aa0a8] max-md:text-[10px]">
      {typeLabel ? <span>{typeLabel}</span> : null}
      {typeLabel && summary.length > 0 ? <span> · </span> : null}
      {summary.length > 0 ? (
        <>
          <span>사용한 판단 · </span>
          <span>{desktopParts.join(" · ")}</span>
        </>
      ) : null}
    </div>
  );
}

function DetailLine({
  modelLabel,
  durationMs,
  detailMeta
}: {
  modelLabel: string;
  durationMs?: number | null;
  detailMeta?: LunaDetailMeta | null;
}) {
  const [open, setOpen] = useState(false);
  const steps = detailMeta?.steps ?? [];
  const modelSteps = detailMeta?.modelSteps ?? [];
  const wsSearches = detailMeta?.wsSearches ?? [];
  const connectorRouting = detailMeta?.connectorRouting ?? null;
  const timingRows = buildDetailTimingRows({
    steps: steps.map((s) => ({
      key: s.key,
      label: s.label,
      status: s.status,
      ms: s.ms,
      right: s.right
    })),
    timings: detailMeta?.timings ?? null,
    classificationLabel: detailMeta?.classificationLabel ?? null,
    classifySource: detailMeta?.classifySource ?? null,
    keywords: detailMeta?.keywords ?? null
  });
  const summaryLine = formatDetailSummaryLine({
    modelLabel,
    timings: detailMeta?.timings ?? null,
    durationMs
  });
  const hasDetail =
    timingRows.length > 0 ||
    modelSteps.length > 0 ||
    steps.length > 0 ||
    wsSearches.length > 0 ||
    Boolean(connectorRouting?.summary);

  return (
    <>
      <div className="mt-0.5 text-[10.5px] text-[#9aa0a8]">
        {summaryLine || modelLabel}
        {hasDetail ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[#534AB7] hover:underline"
            >
              자세히
            </button>
          </>
        ) : null}
      </div>
      {open && hasDetail ? (
        <div className="mt-1.5 rounded-lg border border-[#E3E0F5] bg-white px-[11px] py-[9px]">
          {timingRows.length > 0 ? (
            <div className="mb-2 space-y-1">
              <p className="text-[10px] font-medium text-[#6b6f76]">단계별 시간</p>
              {timingRows.map((row) => (
                <div
                  key={row.key}
                  className="flex gap-2 text-[10.5px] text-[#6b6f76]"
                >
                  <span className="min-w-0 flex-1">{row.label}</span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#9aa0a8]">
                    {row.right}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {connectorRouting?.summary ? (
            <div className="mb-2 text-[10.5px] text-[#6b6f76]">
              {connectorRouting.summary}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function AnswerMeta({
  messageId,
  content,
  cards,
  notionSources,
  wikiSources,
  privateWikiRefs,
  memoryCount,
  canFeedback,
  initialFeedback,
  initialReason,
  initialNote,
  modelLabel,
  durationMs,
  detailMeta,
  usedPrompts,
  classification,
  intentScore,
  confidenceScore,
  selfNote,
  showAnswerScores,
  docsTabLabel,
  onDocsTab
}: {
  messageId: string;
  content: string;
  cards: LunaCard[];
  notionSources: NotionSource[];
  wikiSources: WikiSourceRef[];
  privateWikiRefs: WikiSourceRef[];
  memoryCount: number;
  canFeedback: boolean;
  initialFeedback?: "good" | "bad" | null;
  initialReason?: FeedbackReason | null;
  initialNote?: string | null;
  modelLabel?: string | null;
  durationMs?: number | null;
  detailMeta?: LunaDetailMeta | null;
  usedPrompts?: UsedPromptRef[] | null;
  classification?: LunaClassificationMeta | null;
  intentScore?: number | null;
  confidenceScore?: number | null;
  selfNote?: string | null;
  showAnswerScores?: boolean;
  docsTabLabel?: string | null;
  onDocsTab?: () => void;
}) {
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(
    initialFeedback ?? null
  );
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(
    initialReason ?? null
  );
  const [feedbackNote, setFeedbackNote] = useState<string | null>(
    clipFeedbackNote(initialNote)
  );
  const [noteDraft, setNoteDraft] = useState(
    () => clipFeedbackNote(initialNote) ?? ""
  );
  const [reasonPanelCollapsed, setReasonPanelCollapsed] = useState(
    () => Boolean(clipFeedbackNote(initialNote))
  );
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    const note = clipFeedbackNote(initialNote);
    setFeedback(initialFeedback ?? null);
    setFeedbackReason(initialReason ?? null);
    setFeedbackNote(note);
    setNoteDraft(note ?? "");
    setReasonPanelCollapsed(Boolean(note));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- message identity only
  }, [messageId]);

  async function sendFeedback(
    next: "good" | "bad" | null,
    opts?: { reason?: FeedbackReason | null; note?: string; collapse?: boolean }
  ) {
    if (!canFeedback || busy) return;
    const prev = feedback;
    const prevReason = feedbackReason;
    const prevNote = feedbackNote;
    const prevDraft = noteDraft;
    const prevCollapsed = reasonPanelCollapsed;
    const reason = opts?.reason;
    const noteToSend =
      opts && Object.prototype.hasOwnProperty.call(opts, "note")
        ? clipFeedbackNote(opts.note)
        : undefined;
    setBusy(true);
    setFeedbackError(null);
    setFeedback(next);
    if (next !== "bad") {
      setFeedbackReason(null);
      setFeedbackNote(null);
      setNoteDraft("");
      setReasonPanelCollapsed(false);
    } else {
      if (reason) setFeedbackReason(reason);
      if (noteToSend !== undefined) setFeedbackNote(noteToSend);
    }
    try {
      let token = await getAccessToken();
      if (!token) {
        const refreshed = await supabase.auth.refreshSession();
        token = refreshed.data.session?.access_token ?? null;
      }
      if (!token) {
        setFeedback(prev);
        setFeedbackReason(prevReason);
        setFeedbackNote(prevNote);
        setNoteDraft(prevDraft);
        setReasonPanelCollapsed(prevCollapsed);
        setFeedbackError("로그인이 필요합니다. 다시 로그인한 뒤 눌러 주세요.");
        return;
      }
      const res = await fetch("/api/luna/messages", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message_id: messageId,
          feedback: next,
          ...(next === "bad" && reason ? { reason } : {}),
          ...(next === "bad" && noteToSend !== undefined
            ? { note: noteToSend ?? "" }
            : {})
        })
      });
      if (!res.ok) {
        setFeedback(prev);
        setFeedbackReason(prevReason);
        setFeedbackNote(prevNote);
        setNoteDraft(prevDraft);
        setReasonPanelCollapsed(prevCollapsed);
        setFeedbackError(
          res.status === 401
            ? "로그인이 만료되었습니다. 다시 로그인해 주세요."
            : "평가를 저장하지 못했습니다. 다시 눌러 주세요."
        );
        return;
      }
      const json = (await res.json()) as {
        feedback?: "good" | "bad" | null;
        reason?: unknown;
        note?: unknown;
      };
      setFeedback(
        json.feedback === "good" || json.feedback === "bad" ? json.feedback : null
      );
      setFeedbackReason(isFeedbackReason(json.reason) ? json.reason : null);
      const savedNote = clipFeedbackNote(json.note);
      setFeedbackNote(savedNote);
      if (noteToSend !== undefined) setNoteDraft(savedNote ?? "");
      if (opts?.collapse) setReasonPanelCollapsed(true);
    } catch {
      setFeedback(prev);
      setFeedbackReason(prevReason);
      setFeedbackNote(prevNote);
      setNoteDraft(prevDraft);
      setReasonPanelCollapsed(prevCollapsed);
      setFeedbackError("네트워크 오류로 평가를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function copyContent() {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(
      () => setCopied(true),
      () => {
        /* ignore */
      }
    );
  }

  const showScores = showAnswerScores === true;
  const lowIntent = typeof intentScore === "number" && intentScore < 5;
  const lowConf = typeof confidenceScore === "number" && confidenceScore < 5;

  return (
    <>
      <div className="mt-3.5 flex flex-wrap items-center gap-[7px]">
        <SourceChips
          cards={cards}
          notionSources={notionSources}
          wikiSources={wikiSources}
          privateWikiRefs={privateWikiRefs}
          memoryCount={memoryCount}
        />
        {showScores && typeof intentScore === "number" ? (
          <span className="rounded-full border border-[#e7e8ec] bg-[#f1f2f5] px-2.5 py-0.5 text-[10.5px] text-[#6b6f76]">
            의도{" "}
            <span className={scoreTone(intentScore)}>{intentScore}/10</span>
          </span>
        ) : null}
        {showScores && typeof confidenceScore === "number" ? (
          <span className="rounded-full border border-[#e7e8ec] bg-[#f1f2f5] px-2.5 py-0.5 text-[10.5px] text-[#6b6f76]">
            자신감{" "}
            <span className={scoreTone(confidenceScore)}>{confidenceScore}/10</span>
          </span>
        ) : null}
        <div className="ml-1 flex items-center gap-[9px] text-[#9aa0a8]">
          {content ? (
            <button
              type="button"
              aria-label="복사"
              onClick={copyContent}
              className="hover:text-[#6b6f76]"
            >
              <Copy className="h-[15px] w-[15px]" strokeWidth={1.75} />
            </button>
          ) : null}
          {canFeedback ? (
            <>
              <button
                type="button"
                aria-label="좋아요"
                aria-pressed={feedback === "good"}
                disabled={busy}
                onClick={() => {
                  if (feedback === "good") void sendFeedback(null);
                  else void sendFeedback("good");
                }}
                className={
                  feedback === "good" ? "text-[#534AB7]" : "hover:text-[#6b6f76]"
                }
              >
                <ThumbsUp
                  className="h-[15px] w-[15px]"
                  strokeWidth={1.75}
                  fill={feedback === "good" ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                aria-label="싫어요"
                aria-pressed={feedback === "bad"}
                disabled={busy}
                onClick={() => {
                  if (feedback === "bad") void sendFeedback(null);
                  else void sendFeedback("bad");
                }}
                className={
                  feedback === "bad" ? "text-[#534AB7]" : "hover:text-[#6b6f76]"
                }
              >
                <ThumbsDown
                  className="h-[15px] w-[15px]"
                  strokeWidth={1.75}
                  fill={feedback === "bad" ? "currentColor" : "none"}
                />
              </button>
            </>
          ) : null}
        </div>
        {docsTabLabel && onDocsTab ? (
          <button
            type="button"
            onClick={onDocsTab}
            className="ml-auto text-[10.5px] font-semibold text-[#534AB7] hover:underline"
          >
            {docsTabLabel}
          </button>
        ) : null}
      </div>
      {showScores && (lowIntent || lowConf) && selfNote ? (
        <p className="mt-1 text-[11px] italic text-[#B0782B]">{selfNote}</p>
      ) : null}
      {copied ? (
        <p className="mt-1 text-[10px] text-[#0F6E56]">복사했어요</p>
      ) : null}
      {canFeedback && feedback === "bad" ? (
        reasonPanelCollapsed ? (
          <div className="mt-1.5 rounded-md bg-[#f3f4f6] px-2.5 py-1.5">
            {feedbackReason ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#534AB7]">
                {FEEDBACK_REASON_LABELS[feedbackReason]}
              </span>
            ) : null}
            {feedbackNote ? (
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#33363c]">
                {feedbackNote}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-1.5">
            <p className="mb-1 text-[10.5px] text-[#9aa0a8]">
              무엇이 아쉬웠나요? (건너뛸 수 있어요)
            </p>
            <div className="flex flex-wrap gap-1">
              {FEEDBACK_REASON_IDS.map((rid) => (
                <button
                  key={rid}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendFeedback("bad", { reason: rid })}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    feedbackReason === rid
                      ? "bg-[#534AB7] text-white"
                      : "bg-[#f3f4f6] text-[#6b6f76]"
                  }`}
                >
                  {FEEDBACK_REASON_LABELS[rid]}
                </button>
              ))}
            </div>
            <textarea
              value={noteDraft}
              maxLength={FEEDBACK_NOTE_MAX}
              disabled={busy}
              placeholder="직접 적어주세요 (선택)"
              onChange={(e) =>
                setNoteDraft(e.target.value.slice(0, FEEDBACK_NOTE_MAX))
              }
              className="mt-1.5 w-full resize-none rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#c4bff0]"
              rows={2}
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void sendFeedback("bad", { reason: null, note: "", collapse: true })
                }
                className="rounded-md px-2.5 py-1 text-[11px] text-[#6b6f76]"
              >
                건너뛰기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void sendFeedback("bad", {
                    reason: feedbackReason,
                    note: noteDraft,
                    collapse: true
                  })
                }
                className="rounded-md bg-[#534AB7] px-2.5 py-1 text-[11px] text-white"
              >
                남기기
              </button>
            </div>
          </div>
        )
      ) : null}
      {feedbackError ? (
        <p className="mt-1 text-[11px] text-[#c23b3b]">{feedbackError}</p>
      ) : null}
      {(usedPrompts && usedPrompts.length > 0) || classification ? (
        <UsedPromptsLine
          usedPrompts={usedPrompts ?? []}
          classification={classification}
        />
      ) : null}
      {modelLabel ? (
        <DetailLine
          modelLabel={modelLabel}
          durationMs={durationMs}
          detailMeta={detailMeta}
        />
      ) : null}
    </>
  );
}
