"use client";

import { useState } from "react";
import type {
  CandidateRow,
  ReviewProposal
} from "@/components/luna/candidates/shared";
import { Btn } from "@/components/luna/knowledge/ui";
import { FEEDBACK_NOTE_MAX } from "@/lib/luna/feedback";
import { stripConfirmClaimDisplay } from "@/lib/luna/candidate-format";
import { formatKoreanDay, K, sourceLabel } from "@/lib/luna/knowledge-format";

const OLD = { ink: "#8A6D2F", bg: "#FAF7EE" };
const NEW = { ink: "#0F6E56", bg: "#EAF7F2" };
const LOCK = { ink: "#8A6D2F", bg: "#FAF3E2" };

export type KnowledgeReviewAction =
  | "accept_proposal"
  | "keep_both"
  | "replace_with_new"
  | "discard_new"
  | "rewrite"
  | "accept_existing"
  | "accept_new"
  | "later"
  | "reject";

export function KnowledgeReviewCard({
  item,
  busy,
  error,
  onAction
}: {
  item: CandidateRow;
  busy: boolean;
  error?: string;
  onAction: (
    action: KnowledgeReviewAction,
    text?: string,
    rejectNote?: string
  ) => void;
}) {
  const [noOpen, setNoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [choice, setChoice] = useState<
    "keep_both" | "replace_with_new" | "discard_new" | "rewrite" | null
  >(null);
  const [rejectNote, setRejectNote] = useState("");

  const isDup = Boolean(item.duplicate);
  const proposal: ReviewProposal | null = item.proposal ?? null;
  const kind = proposal?.kind ?? (isDup ? "rewrite" : "new");
  const sentence = proposal?.sentence || item.content;
  const reason = proposal?.reason || "";

  const tag = isDup ? "겹침" : "새 지식";
  const title = isDup
    ? "아폴론 지식과 비슷한 내용이에요"
    : "처음 듣는 내용이에요";
  const proposeLabel = isDup ? "🌙 이렇게 하려고 해요" : "🌙 이렇게 이해했어요";

  const existingMeta = item.duplicate
    ? [
        formatKoreanDay(item.duplicate.created_at),
        item.duplicate.version_count > 0
          ? `${item.duplicate.version_count}번 고쳐짐`
          : null
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const incomingMeta = [
    formatKoreanDay(item.created_at),
    sourceLabel(item.source)
  ]
    .filter((v) => v && v !== "—")
    .join(" · ");

  function pickChoice(
    next: "keep_both" | "replace_with_new" | "discard_new" | "rewrite"
  ) {
    setChoice((prev) => (prev === next ? null : next));
    if (next === "rewrite") {
      setEditText((t) => t || sentence);
      setEditOpen(true);
    } else {
      setEditOpen(false);
    }
  }

  function submitNo() {
    const note = rejectNote.trim().slice(0, FEEDBACK_NOTE_MAX);
    if (choice === "rewrite") {
      const sentenceText = editText.trim();
      if (!sentenceText) return;
      onAction("rewrite", sentenceText, note || undefined);
      return;
    }
    if (choice) {
      onAction(choice, undefined, note || undefined);
      return;
    }
    if (note) onAction("reject", undefined, note);
  }

  const canSubmitNo =
    choice === "rewrite"
      ? Boolean(editText.trim())
      : Boolean(choice || rejectNote.trim());

  return (
    <article
      className="overflow-hidden rounded-[12px]"
      style={{ border: `1px solid ${K.line}`, background: K.panel }}
    >
      <div
        className="flex items-center gap-2 px-[15px] py-[11px]"
        style={{
          background: "#FBFBFC",
          borderBottom: `1px solid ${K.line2}`
        }}
      >
        <span
          className="rounded-[9px] px-[7px] py-0.5 text-[9.5px] font-bold"
          style={
            isDup
              ? { background: LOCK.bg, color: LOCK.ink }
              : { background: NEW.bg, color: NEW.ink }
          }
        >
          {tag}
        </span>
        <span className="text-[12px] font-semibold">{title}</span>
      </div>

      <div className="px-[15px] py-[15px]">
        {isDup && item.duplicate ? (
          <div
            className="mb-3.5 flex overflow-hidden rounded-[10px]"
            style={{ border: `1px solid ${K.line}` }}
          >
            <div
              className="min-w-0 flex-1 px-3.5 py-3"
              style={{
                background: OLD.bg,
                borderRight: `1px solid ${K.line}`
              }}
            >
              <div
                className="mb-1.5 text-[10px] font-bold"
                style={{ color: OLD.ink }}
              >
                이미 아는 것
              </div>
              <div className="text-[12.5px] leading-[1.75]">
                {stripConfirmClaimDisplay(item.duplicate.content)}
              </div>
              {existingMeta ? (
                <div className="mt-1.5 text-[10px]" style={{ color: K.faint }}>
                  {existingMeta}
                </div>
              ) : null}
            </div>
            <div
              className="min-w-0 flex-1 px-3.5 py-3"
              style={{ background: NEW.bg }}
            >
              <div
                className="mb-1.5 text-[10px] font-bold"
                style={{ color: NEW.ink }}
              >
                새로 들은 것
              </div>
              <div className="text-[12.5px] leading-[1.75]">
                {stripConfirmClaimDisplay(item.content)}
              </div>
              {incomingMeta ? (
                <div className="mt-1.5 text-[10px]" style={{ color: K.faint }}>
                  {incomingMeta}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {item.duplicate && item.duplicate.extra_count > 0 ? (
          <div className="mb-3">
            <button
              type="button"
              className="text-[11px]"
              style={{ color: K.faint }}
              onClick={() => setExtrasOpen((v) => !v)}
            >
              이 밖에 {item.duplicate.extra_count}건과도 비슷해요
              {extrasOpen ? " ▲" : " ▼"}
            </button>
            {extrasOpen ? (
              <ul className="mt-1.5 space-y-1">
                {item.duplicate.extras.map((ex) => (
                  <li
                    key={ex.id}
                    className="rounded-[8px] px-2.5 py-1.5 text-[12px] leading-relaxed"
                    style={{ background: K.chip, color: K.sub }}
                  >
                    {ex.content}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div
          className="mb-3 rounded-[10px] px-[15px] py-[13px]"
          style={{
            border: `1px solid ${K.lunaSoft}`,
            background: "#FCFBFF"
          }}
        >
          <div
            className="mb-1.5 text-[11px] font-bold"
            style={{ color: K.lunaInk }}
          >
            {proposeLabel}
          </div>
          {kind === "conflict" ? (
            <p className="text-[13px] leading-[1.8]" style={{ color: K.sub }}>
              {reason || "어느 쪽이 맞는지 골라 주세요."}
            </p>
          ) : (
            <div className="text-[13px] leading-[1.8]">{stripConfirmClaimDisplay(sentence)}</div>
          )}
          {kind !== "conflict" && reason ? (
            <p className="mt-2 text-[11px] leading-[1.6]" style={{ color: K.faint }}>
              {reason}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mb-2 text-[12px]" style={{ color: K.danger }}>
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-[7px]">
          {kind === "conflict" ? (
            <>
              <Btn
                disabled={busy}
                onClick={() => onAction("accept_existing")}
              >
                이미 아는 것이 맞아요
              </Btn>
              <Btn
                primary
                disabled={busy}
                onClick={() => onAction("accept_new")}
              >
                새로 들은 것이 맞아요
              </Btn>
            </>
          ) : (
            <Btn
              primary
              disabled={busy}
              onClick={() => onAction("accept_proposal")}
            >
              {busy ? "처리 중…" : "맞아요"}
            </Btn>
          )}
          <Btn
            disabled={busy}
            onClick={() => {
              setNoOpen(true);
              setEditOpen(false);
            }}
          >
            아니에요
          </Btn>
          <span className="flex-1" />
          <Btn
            disabled={busy}
            className="bg-transparent"
            onClick={() => onAction("later")}
          >
            나중에
          </Btn>
        </div>

        {noOpen ? (
          <div
            className="mt-3 pt-3"
            style={{ borderTop: `1px solid ${K.line2}` }}
          >
            <div className="mb-2 text-[11px]" style={{ color: K.sub }}>
              무엇이 아니었나요?
            </div>
            <div className="flex flex-wrap gap-1.5">
              {isDup ? (
                <>
                  <MoreOpt
                    disabled={busy}
                    selected={choice === "keep_both"}
                    onClick={() => pickChoice("keep_both")}
                  >
                    둘 다 남기기
                  </MoreOpt>
                  <MoreOpt
                    disabled={busy}
                    selected={choice === "replace_with_new"}
                    onClick={() => pickChoice("replace_with_new")}
                  >
                    새 것으로 바꾸기
                  </MoreOpt>
                  <MoreOpt
                    disabled={busy}
                    selected={choice === "discard_new"}
                    onClick={() => pickChoice("discard_new")}
                  >
                    새 것 버리기
                  </MoreOpt>
                </>
              ) : (
                <MoreOpt
                  disabled={busy}
                  selected={choice === "discard_new"}
                  onClick={() => pickChoice("discard_new")}
                >
                  버리기
                </MoreOpt>
              )}
              <MoreOpt
                disabled={busy}
                selected={choice === "rewrite"}
                onClick={() => pickChoice("rewrite")}
              >
                직접 고쳐 쓰기
              </MoreOpt>
            </div>
            {editOpen ? (
              <div className="mt-2.5">
                <textarea
                  className="w-full rounded-[9px] border px-2.5 py-2 text-[12.5px] leading-[1.75]"
                  style={{
                    borderColor: K.luna,
                    background: "#FCFCFD",
                    minHeight: 70
                  }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
              </div>
            ) : null}
            <textarea
              className="mt-2.5 w-full rounded-[9px] border px-2.5 py-2 text-[12.5px] leading-[1.75]"
              style={{
                borderColor: K.line,
                background: "#FCFCFD",
                minHeight: 64
              }}
              maxLength={FEEDBACK_NOTE_MAX}
              placeholder="왜 그런지 적어주세요 (선택)"
              value={rejectNote}
              onChange={(e) =>
                setRejectNote(e.target.value.slice(0, FEEDBACK_NOTE_MAX))
              }
            />
            <div className="mt-2 flex justify-end">
              <Btn
                primary
                disabled={busy || !canSubmitNo}
                onClick={submitNo}
              >
                {busy ? "처리 중…" : "처리"}
              </Btn>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MoreOpt({
  children,
  disabled,
  selected,
  onClick
}: {
  children: string;
  disabled?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-[9px] border px-3 py-1.5 text-[11.5px] disabled:opacity-50"
      style={{
        borderColor: selected ? K.luna : K.line,
        background: selected ? "#FCFBFF" : K.panel,
        color: "#33363c",
        fontWeight: selected ? 700 : 400
      }}
    >
      {children}
    </button>
  );
}
