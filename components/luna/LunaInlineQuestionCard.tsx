"use client";

import { useState } from "react";
import type { LunaPendingQuestion } from "@/components/luna/use-luna-pending-question";

type Props = {
  question: LunaPendingQuestion | null;
  answeredMessage: string | null;
  answeredContent: string | null;
  busy?: boolean;
  error?: string | null;
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
  onAnswer,
  onDismiss,
  onCloseAnswered
}: Props) {
  const [freeText, setFreeText] = useState(false);
  const [draft, setDraft] = useState("");

  if (answeredMessage && answeredContent) {
    return (
      <div
        className="mx-3 mb-3 rounded-[14px] border border-[#BA7517] px-3.5 py-3 md:hidden"
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

  return (
    <div
      className="mx-3 mb-3 rounded-[14px] border border-[#BA7517] px-3.5 py-3 md:hidden"
      style={{ background: "#FAEEDA" }}
    >
      <p className="text-[14px] font-medium leading-snug text-[#1C1C1A]">
        {question.question}
      </p>
      {question.context?.trim() ? (
        <p className="mt-1 text-[12px] text-[#6B6A64]">{question.context}</p>
      ) : null}

      {options.length > 0 ? (
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

      {options.length === 0 || freeText ? (
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
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setFreeText(true)}
          className="chip-sm mt-2 text-[12px] text-[#534AB7]"
        >
          직접 쓸게요
        </button>
      )}

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="chip-sm text-[12px] text-[#6B6A64]"
        >
          나중에
        </button>
      </div>
    </div>
  );
}
