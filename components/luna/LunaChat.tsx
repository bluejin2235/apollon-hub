"use client";

import { useEffect, useRef } from "react";
import { LunaInput, type LunaEngineOption } from "@/components/luna/LunaInput";
import { LunaMessage } from "@/components/luna/LunaMessage";
import type { LunaConversation } from "@/components/luna/LunaSidebar";

export type LunaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
};

const SUGGESTIONS = [
  "아폴론의 미디어 설치 사례를 알려줘",
  "이번 주 트렌드 리서치 어떻게 하면 좋을까?",
  "디지털 랜드마크란 무엇인지 설명해줘"
];

const ENGINE_BADGE: Record<string, string> = {
  auto: "Auto",
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini"
};

type LunaChatProps = {
  conversation: LunaConversation | null;
  messages: LunaChatMessage[];
  engine: LunaEngineOption;
  onEngineChange: (engine: LunaEngineOption) => void;
  onSend: (message: string) => void;
  onSuggestion: (text: string) => void;
  onBack?: () => void;
  sending?: boolean;
  showMobileHeader?: boolean;
};

export function LunaChat({
  conversation,
  messages,
  engine,
  onEngineChange,
  onSend,
  onSuggestion,
  onBack,
  sending,
  showMobileHeader
}: LunaChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const title = conversation?.title ?? "새 대화";
  const engineBadge =
    ENGINE_BADGE[(conversation?.engine ?? engine).toLowerCase()] ??
    ENGINE_BADGE[engine] ??
    "Auto";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const isEmpty = messages.length === 0 && !sending;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      {showMobileHeader ? (
        <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-3 md:hidden">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            aria-label="뒤로가기"
          >
            ←
          </button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-xs font-semibold text-white">
            L
          </div>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {title}
          </div>
        </div>
      ) : null}

      <div className="hidden items-center justify-between border-b border-slate-200 px-5 py-3 md:flex">
        <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
        <span className="shrink-0 rounded-full bg-[#EEEDFE] px-2.5 py-1 text-xs font-medium text-[#3C3489]">
          {engineBadge}
        </span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#534AB7] text-xl font-semibold text-white">
              L
            </div>
            <p className="mb-6 text-base font-medium text-slate-800">
              안녕하세요, 저는 루나입니다
            </p>
            <div className="flex w-full max-w-md flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={sending}
                  onClick={() => onSuggestion(s)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition hover:border-[#534AB7]/40 hover:bg-[#EEEDFE]/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl pb-2">
            {messages.map((m) => (
              <LunaMessage
                key={m.id}
                role={m.role}
                content={m.content}
                engine={m.engine}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <LunaInput
          engine={engine}
          onEngineChange={onEngineChange}
          onSend={onSend}
          disabled={sending}
        />
      </div>
    </div>
  );
}
