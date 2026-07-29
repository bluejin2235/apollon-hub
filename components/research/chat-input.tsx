"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

type ChatInputProps = {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
};

function IconSend(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6l-.9 7.8 9.6 1.2-9.6 1.2.9 7.8Z" />
    </svg>
  );
}

export function ChatInput({ disabled = false, onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setValue("");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="shrink-0 bg-white px-4 pb-4 pt-2 sm:px-6">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div
          className="flex items-end gap-2 rounded-[26px] px-4 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
          style={{ background: "var(--color-background-secondary, #f4f4f4)" }}
        >
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="링크, 영상, 기사를 던져주세요. 루나가 분석할게요."
            rows={1}
            disabled={disabled || sending}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-[#0d0d0d] placeholder:text-[#8e8e8e] focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || sending || !value.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition hover:bg-[#333] disabled:cursor-not-allowed disabled:bg-[#d1d1d1] disabled:text-[#8e8e8e]"
            aria-label="전송"
          >
            <IconSend className="h-4 w-4" />
          </button>
        </div>
        {disabled ? (
          <p className="mt-2 text-center text-xs text-[#8e8e8e]">아카이브된 채팅방입니다. 메시지를 보낼 수 없습니다.</p>
        ) : null}
      </form>
    </div>
  );
}
