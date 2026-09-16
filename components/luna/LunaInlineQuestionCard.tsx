"use client";

import { useState } from "react";
import type { LunaPendingQuestion } from "@/components/luna/use-luna-pending-question";

type Props = {
  question: LunaPendingQuestion | null;
  answeredMessage: string | null;
  answeredContent: string | null;
  busy?: boolean;
  error?: string | null;
  variant?: "chat" | "bubble";
  count?: number;
  onAnswer: (answer: string) => void | Promise<void>;
  onDismiss: () => void;
  onCloseAnswered: () => void;
};

export function LunaInlineQuestionCard({
  question,
  answeredMessage,
  answeredContent,
  busy,
  error,
  variant = "chat",
  count,
  onAnswer,
  onDismiss,
  onCloseAnswered
}: Props) {
  const [freeText, setFreeText] = useState(false);
  const [draft, setDraft] = useState("");

  if (answeredMessage && answeredContent) {
    return (
      <div
        className="mx-3 mb-3 rounded-[14px] border border-[#BA7517] px-3.5 py-3"
        style={{ background: "#FAEEDA" }}
      >
        <p className="text-[14px] font-medium text-[#412402]">{answeredMessage}</p>
        <blockquote className="mt-2 border-l-2 border-[#BA7517] pl-2.5 text-[13px] leading-relaxed text-[#412402]">
          {answeredContent}
        </blockquote>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCloseAnswered}
            className="text-[12px] text-[#6B6A64]"
          >
            닫기
          </button>
        </div>
      </div>
    );
  }

  if (!question) return null;

  const options = question.options?.filter((o) => o.trim()) ?? [];
  const showSame = question.kind !== "other";
  const bubble = variant === "bubble";

  return (
    <div
      className={
        bubble
          ? "flex min-h-0 flex-1 flex-col gap-2.5"
          : "mx-3 mb-3 rounded-[14px] border border-[#BA7517] px-3.5 py-3"
      }
      style={bubble ? undefined : { background: "#FAEEDA" }}
    >
      {bubble ? (
        <p className="text-[13px] font-medium text-slate-900">
          🌙 질문이 {Math.max(1, count ?? 1)}개 있어요
        </p>
      ) : (
        <p className="text-[13px] font-medium text-[#412402]">
          🌙 그런데 하나 여쭤봐도 될까요?
        </p>
      )}
      <p className="text-[14px] font-medium leading-snug text-[#1C1C1A]">
        {question.question}
      </p>
      {question.context?.trim() && !bubble ? (
        <p className="mt-1 text-[12px] text-[#6B6A64]">{question.context}</p>
      ) : null}

      {showSame ? (
        <div className={bubble ? "mt-1 flex flex-col gap-1.5" : "mt-3 flex flex-wrap gap-2"}>
          {(["같아요", "달라요"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy}
              onClick={() => void onAnswer(opt)}
              className={
                bubble
                  ? "w-full rounded-[9px] border border-[#D3D1C7] bg-white py-2 text-[12px] text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  : "chip-sm h-9 rounded-[10px] border border-[#D3D1C7] bg-white px-3 text-[13px] text-[#1C1C1A] transition hover:border-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
              }
            >
              {opt}
            </button>
          ))}
          {bubble ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAnswer("모르겠어요")}
              className="w-full rounded-[9px] border border-[#D3D1C7] bg-white py-2 text-[12px] text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              모르겠어요
            </button>
          ) : null}
        </div>
      ) : options.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy}
              onClick={() => void onAnswer(opt)}
              className="chip-sm flex h-11 w-full items-center justify-center rounded-[10px] border border-[#D3D1C7] bg-white text-[14px] text-[#1C1C1A] transition hover:border-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}

      {!showSame && (options.length === 0 || freeText) ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            disabled={busy}
            placeholder="답변을 입력해 주세요"
            className="w-full rounded-[10px] border border-[#D3D1C7] bg-white px-3 py-2 text-[13.5px] outline-none focus:border-[#534AB7]"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void onAnswer(draft.trim())}
            className="chip-sm h-11 w-full rounded-[10px] bg-[#534AB7] text-[14px] font-medium text-white disabled:opacity-50"
          >
            보내기
          </button>
        </div>
      ) : !showSame ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setFreeText(true)}
          className="chip-sm mt-2 text-[12px] text-[#534AB7]"
        >
          직접 쓸게요
        </button>
      ) : null}

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      <div className={bubble ? "mt-1" : "mt-3 flex justify-end"}>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className={
            bubble
              ? "w-full py-1.5 text-[12px] text-gray-500 disabled:opacity-50"
              : "chip-sm text-[12px] text-[#6B6A64]"
          }
        >
          나중에
        </button>
      </div>
      {bubble ? (
        <p className="text-[11px] text-gray-500">바쁘면 무시해도 됩니다.</p>
      ) : null}
    </div>
  );
}
