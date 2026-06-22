"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

type ChatInputProps = {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
};

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
    <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요… (Shift+Enter 줄바꿈)"
          rows={1}
          disabled={disabled || sending}
          className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-apollon-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-apollon-500/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || sending || !value.trim()}
          className="shrink-0 rounded-xl bg-apollon-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-apollon-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "전송 중…" : "전송"}
        </button>
      </div>
    </form>
  );
}
