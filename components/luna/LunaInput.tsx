"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

export type LunaEngineOption = "auto" | "claude" | "gpt" | "gemini";

const ENGINE_LABELS: Record<LunaEngineOption, string> = {
  auto: "Auto",
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini"
};

const CONNECTORS = [
  { key: "notion", label: "노션" },
  { key: "web", label: "웹검색" },
  { key: "youtube", label: "YouTube" },
  { key: "hubdb", label: "HubDB" }
] as const;

type LunaInputProps = {
  engine: LunaEngineOption;
  onEngineChange: (engine: LunaEngineOption) => void;
  onSend: (message: string) => void;
  disabled?: boolean;
};

export function LunaInput({ engine, onEngineChange, onSend, disabled }: LunaInputProps) {
  const [value, setValue] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (plusRef.current && !plusRef.current.contains(target)) setPlusOpen(false);
      if (engineRef.current && !engineRef.current.contains(target)) setEngineOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2">
        <div className="relative shrink-0" ref={plusRef}>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            aria-label="추가 메뉴"
            onClick={() => {
              setPlusOpen((v) => !v);
              setEngineOpen(false);
            }}
          >
            <span className="text-xl leading-none">+</span>
          </button>
          {plusOpen ? (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                className="flex w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setPlusOpen(false)}
              >
                파일추가
              </button>
              <button
                type="button"
                className="flex w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setPlusOpen(false)}
              >
                스킬
              </button>
              <div className="flex items-center justify-between px-3 py-2.5 text-sm text-slate-700">
                <span>커넥터</span>
                <span className="flex items-center gap-1" title="미연결">
                  {CONNECTORS.map((c) => (
                    <span
                      key={c.key}
                      className="inline-block h-1.5 w-1.5 rounded-full bg-gray-300"
                      title={`${c.label} 미연결`}
                    />
                  ))}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder="루나에게 메시지 보내기"
          className="max-h-40 min-h-[36px] flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 [field-sizing:content] disabled:opacity-50"
        />

        <div className="relative shrink-0" ref={engineRef}>
          <button
            type="button"
            className="flex h-9 items-center gap-0.5 rounded-full bg-white px-2.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100"
            onClick={() => {
              setEngineOpen((v) => !v);
              setPlusOpen(false);
            }}
          >
            {ENGINE_LABELS[engine]}
            <span className="text-[10px] text-slate-400">▾</span>
          </button>
          {engineOpen ? (
            <div className="absolute bottom-full right-0 z-20 mb-2 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {(Object.keys(ENGINE_LABELS) as LunaEngineOption[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    onEngineChange(key);
                    setEngineOpen(false);
                  }}
                >
                  <span>{ENGINE_LABELS[key]}</span>
                  {engine === key ? <span className="text-[#534AB7]">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-white transition hover:bg-[#3C3489] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="전송"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
            <path d="M3.4 20.4 20.85 12.92c.76-.33.76-1.51 0-1.84L3.4 3.6c-.65-.28-1.34.34-1.17 1.03L3.7 11l8.05 1-8.05 1-.1 6.37c-.05.69.62 1.2 1.17.93z" />
          </svg>
        </button>
      </div>
    </form>
  );
}
