"use client";

import { useEffect, useRef } from "react";
import {
  LunaInput,
  type LunaAttachmentRef,
  type LunaConnectorsState,
  type LunaSkillsSelection
} from "@/components/luna/LunaInput";
import {
  LunaMessage,
  type LunaAnalysisTeam,
  type LunaClarifyData,
  type LunaModelStep,
  type LunaProgressStep
} from "@/components/luna/LunaMessage";
import type { LunaConversation } from "@/components/luna/LunaSidebar";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function callReflect(conversationId: string) {
  const token = await getAccessToken();
  if (!token) return;
  try {
    await fetch("/api/luna/reflect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ conversation_id: conversationId })
    });
  } catch (err) {
    console.error("[luna] reflect", err);
  }
}

export const THINKING_MESSAGE_ID = "thinking";

export type { LunaAnalysisTeam };

export type LunaChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  feedback?: "good" | "bad" | null;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  attachments?: LunaAttachmentRef[] | null;
  isThinking?: boolean;
  metadata?: { isThinking?: boolean } | null;
  modelLabel?: string | null;
  durationMs?: number | null;
  modelSteps?: LunaModelStep[] | null;
  steps?: LunaProgressStep[] | null;
  searchRounds?: number | null;
  clarify?: LunaClarifyData | null;
  mode?: "analysis" | null;
  teams?: LunaAnalysisTeam[] | null;
};

export function createThinkingMessage(): LunaChatMessage {
  return {
    id: THINKING_MESSAGE_ID,
    role: "assistant",
    content: "",
    isThinking: true,
    metadata: { isThinking: true },
    steps: []
  };
}

export function addThinkingMessage(prev: LunaChatMessage[]): LunaChatMessage[] {
  if (prev.some((item) => item.id === THINKING_MESSAGE_ID)) return prev;
  return [...prev, createThinkingMessage()];
}

export function removeThinkingMessage(prev: LunaChatMessage[]): LunaChatMessage[] {
  return prev.filter((item) => item.id !== THINKING_MESSAGE_ID);
}

export function normalizeLunaCards(raw: unknown): LunaCard[] | null {
  if (!Array.isArray(raw)) return null;
  const cards = raw
    .filter((c) => {
      if (!c || typeof c !== "object") return false;
      const row = c as Record<string, unknown>;
      const validType =
        row.type === "web" ||
        row.type === "youtube" ||
        row.type === "notion" ||
        row.type === "nas";
      const validUrl = typeof row.url === "string" || row.url === null;
      return validType && typeof row.title === "string" && validUrl;
    })
    .map((c) => {
      const row = c as Record<string, unknown>;
      return {
        type: row.type as LunaCard["type"],
        title: row.title as string,
        url: typeof row.url === "string" ? row.url : null,
        thumbnail: typeof row.thumbnail === "string" ? row.thumbnail : null,
        description: typeof row.description === "string" ? row.description : ""
      };
    });
  return cards.length > 0 ? cards : null;
}

export function normalizeNotionSources(raw: unknown): NotionSource[] | null {
  if (!Array.isArray(raw)) return null;
  const sources = raw
    .filter(
      (s): s is { title: string; url: string } =>
        Boolean(s) &&
        typeof s === "object" &&
        typeof (s as { title?: unknown }).title === "string" &&
        typeof (s as { url?: unknown }).url === "string"
    )
    .map((s) => ({ title: s.title, url: s.url }));
  return sources.length > 0 ? sources : null;
}

export function normalizeModelSteps(raw: unknown): LunaModelStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps = raw
    .filter(
      (s): s is LunaModelStep =>
        Boolean(s) &&
        typeof s === "object" &&
        typeof (s as { label?: unknown }).label === "string" &&
        typeof (s as { model?: unknown }).model === "string" &&
        typeof (s as { tier?: unknown }).tier === "string"
    )
    .map((s) => ({ label: s.label, model: s.model, tier: s.tier }));
  return steps.length > 0 ? steps : null;
}

export function normalizeProgressSteps(raw: unknown): LunaProgressStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps = raw
    .filter(
      (s): s is LunaProgressStep =>
        Boolean(s) &&
        typeof s === "object" &&
        typeof (s as { key?: unknown }).key === "string" &&
        typeof (s as { label?: unknown }).label === "string" &&
        ((s as { status?: unknown }).status === "running" ||
          (s as { status?: unknown }).status === "done" ||
          (s as { status?: unknown }).status === "skip")
    )
    .map((s) => ({ key: s.key, label: s.label, status: s.status }));
  return steps.length > 0 ? steps : null;
}

export function normalizeClarify(raw: unknown): LunaClarifyData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const question = typeof obj.question === "string" ? obj.question : "";
  const options = Array.isArray(obj.options)
    ? obj.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    : [];
  if (!question || options.length === 0) return null;
  return { question, options };
}

export function normalizeAnalysisTeams(raw: unknown): LunaAnalysisTeam[] | null {
  if (!Array.isArray(raw)) return null;
  const teams = raw
    .filter(
      (t): t is LunaAnalysisTeam =>
        Boolean(t) &&
        typeof t === "object" &&
        typeof (t as { id?: unknown }).id === "string" &&
        typeof (t as { title?: unknown }).title === "string" &&
        typeof (t as { content?: unknown }).content === "string"
    )
    .map((t) => ({ id: t.id, title: t.title, content: t.content }));
  return teams.length > 0 ? teams : null;
}

export type LunaStreamEventResult =
  | { kind: "need_more"; buffer: string }
  | {
      kind: "step";
      buffer: string;
      step: LunaProgressStep;
    }
  | {
      kind: "clarify";
      buffer: string;
      question: string;
      options: string[];
    }
  | {
      kind: "team";
      buffer: string;
      id: string;
      title: string;
      status: "running" | "done";
      content?: string;
    }
  | {
      kind: "meta";
      buffer: string;
      cards: LunaCard[] | null;
      notionSources: NotionSource[] | null;
      mode: "analysis" | null;
      teams: LunaAnalysisTeam[] | null;
    }
  | { kind: "text"; buffer: string };

/** meta 이전: 줄 단위 JSON 이벤트 소비. meta 이후: 전체를 텍스트로. */
export function consumeLunaStreamEvents(
  buffer: string,
  metaReceived: boolean
): LunaStreamEventResult {
  if (metaReceived) {
    return { kind: "text", buffer };
  }

  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex === -1) {
    return { kind: "need_more", buffer };
  }

  const firstLine = buffer.slice(0, newlineIndex);
  const rest = buffer.slice(newlineIndex + 1);

  if (!firstLine.trim()) {
    return consumeLunaStreamEvents(rest, false);
  }

  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type === "step") {
      const status = parsed.status;
      if (
        typeof parsed.key === "string" &&
        typeof parsed.label === "string" &&
        (status === "running" || status === "done" || status === "skip")
      ) {
        return {
          kind: "step",
          buffer: rest,
          step: {
            key: parsed.key,
            label: parsed.label,
            status
          }
        };
      }
    }
    if (parsed.type === "clarify") {
      const question = typeof parsed.question === "string" ? parsed.question : "";
      const options = Array.isArray(parsed.options)
        ? parsed.options.filter(
            (o): o is string => typeof o === "string" && o.trim().length > 0
          )
        : [];
      return { kind: "clarify", buffer: rest, question, options };
    }
    if (parsed.type === "team") {
      const status = parsed.status;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.title === "string" &&
        (status === "running" || status === "done")
      ) {
        return {
          kind: "team",
          buffer: rest,
          id: parsed.id,
          title: parsed.title,
          status,
          content:
            typeof parsed.content === "string" ? parsed.content : undefined
        };
      }
    }
    if (parsed.type === "meta") {
      return {
        kind: "meta",
        buffer: rest,
        cards: normalizeLunaCards(parsed.cards),
        notionSources: normalizeNotionSources(parsed.notion_sources),
        mode: parsed.mode === "analysis" ? "analysis" : null,
        teams: normalizeAnalysisTeams(parsed.teams)
      };
    }
  } catch {
    /* 잘못된 JSON 줄은 무시 */
  }

  return consumeLunaStreamEvents(rest, false);
}

export function buildSearchStatus(connectors: LunaConnectorsState): string[] {
  const status: string[] = [];
  if (connectors.notion) status.push("노션 검색 중...");
  if (connectors.web) status.push("웹 검색 중...");
  if (connectors.nas) status.push("Work서버 검색 중...");
  return status;
}

const SUGGESTIONS = [
  "아폴론의 미디어 설치 사례를 알려줘",
  "이번 주 트렌드 리서치 어떻게 하면 좋을까?",
  "디지털 랜드마크란 무엇인지 설명해줘"
];

type LunaChatProps = {
  conversation: LunaConversation | null;
  messages: LunaChatMessage[];
  onSend: (
    message: string,
    connectors: LunaConnectorsState,
    attachmentIds: string[],
    attachmentMeta: LunaAttachmentRef[],
    skills: LunaSkillsSelection
  ) => void;
  onSuggestion: (text: string) => void;
  onBack?: () => void;
  sending?: boolean;
  searchStatus?: string[];
  showMobileHeader?: boolean;
  onEnsureConversation: () => Promise<string | null>;
};

export function LunaChat({
  conversation,
  messages,
  onSend,
  onSuggestion,
  onBack,
  sending,
  searchStatus = [],
  showMobileHeader,
  onEnsureConversation
}: LunaChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const reflectStateRef = useRef<{ id: string; messageCount: number } | null>(null);
  const title = conversation?.title ?? "새 대화";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending, searchStatus]);

  useEffect(() => {
    const nextId = conversation?.id ?? null;
    const count = messages.filter(
      (m) => !(m.isThinking === true || m.metadata?.isThinking === true)
    ).length;
    const prev = reflectStateRef.current;

    if (prev && prev.id !== nextId && prev.messageCount >= 2) {
      void callReflect(prev.id);
    }

    if (nextId) {
      reflectStateRef.current = { id: nextId, messageCount: count };
    } else if (prev && prev.messageCount >= 2) {
      void callReflect(prev.id);
      reflectStateRef.current = null;
    } else {
      reflectStateRef.current = null;
    }
  }, [conversation?.id, messages]);

  useEffect(() => {
    return () => {
      const prev = reflectStateRef.current;
      if (prev && prev.messageCount >= 2) {
        void callReflect(prev.id);
      }
    };
  }, []);

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

      <div className="hidden items-center border-b border-slate-200 px-5 py-3 md:flex">
        <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
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
            {messages.map((m) => {
              const isThinking =
                m.isThinking === true || m.metadata?.isThinking === true;
              return (
                <LunaMessage
                  key={m.id}
                  id={m.id}
                  role={m.role}
                  content={m.content}
                  engine={m.engine}
                  feedback={m.feedback}
                  notionSources={m.notionSources}
                  cards={m.cards}
                  attachments={m.attachments}
                  isThinking={isThinking}
                  searchStatus={isThinking ? searchStatus : []}
                  modelLabel={m.modelLabel}
                  durationMs={m.durationMs}
                  modelSteps={m.modelSteps}
                  steps={m.steps}
                  searchRounds={m.searchRounds}
                  clarify={m.clarify}
                  mode={m.mode}
                  teams={m.teams}
                  onClarifySelect={
                    m.clarify
                      ? (option) =>
                          onSend(
                            option,
                            { notion: true, web: true, nas: true },
                            [],
                            [],
                            { perspective_ids: [], task_ids: [] }
                          )
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <LunaInput
          onSend={onSend}
          disabled={sending}
          conversationId={conversation?.id ?? null}
          onEnsureConversation={onEnsureConversation}
        />
      </div>
    </div>
  );
}
