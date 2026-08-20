"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, SquarePen } from "lucide-react";
import {
  LunaInput,
  type LunaAttachmentRef,
  type LunaConnectorsState,
  type LunaSkillsSelection
} from "@/components/luna/LunaInput";
import { LunaInlineQuestionCard } from "@/components/luna/LunaInlineQuestionCard";
import {
  LunaMessage,
  type LunaAnalysisTeam,
  type LunaClarifyData,
  type LunaModelStep,
  type LunaNasDriveMode,
  type LunaProgressStep,
  type LunaSourceReasons,
  type LunaDetailMeta
} from "@/components/luna/LunaMessage";
import { loadNasDriveMode, saveNasDriveMode } from "@/lib/luna/nas-path";
import type { LunaConversation } from "@/components/luna/LunaSidebar";
import { useLunaPendingQuestion } from "@/components/luna/use-luna-pending-question";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import { normalizeWikiSources, type WikiSourceRef } from "@/lib/luna/wiki-match";
import {
  parseNumberedChoices,
  resolveChoiceInput,
  normalizeUsedPrompts,
  normalizeClassification,
  type UsedPromptRef,
  type LunaClassificationMeta
} from "@/lib/luna/chat-response";
import type { FeedbackReason } from "@/lib/luna/feedback";
import { ChatShellChrome } from "@/components/chat/ChatShellChrome";
import { useMeasureBottomUi } from "@/hooks/use-measure-bottom-ui";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const reflectingConversationIds = new Set<string>();

function hintFromUserQuery(q: string): string {
  return q
    .trim()
    .replace(/[?？]/g, "")
    .replace(/\s*(찾아줘|어디\s*있어|모아줘|어떻게\s*돼가|며칠.*)$/u, "")
    .replace(/\s*자료\s*$/u, "")
    .replace(/^(작년|올해|최근)\s*/u, "")
    .trim()
    .slice(0, 24);
}

async function callReflect(
  conversationId: string
): Promise<{ correctionIds: string[] }> {
  if (reflectingConversationIds.has(conversationId)) {
    return { correctionIds: [] };
  }
  reflectingConversationIds.add(conversationId);
  try {
    const token = await getAccessToken();
    if (!token) return { correctionIds: [] };
    const res = await fetch("/api/luna/reflect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ conversation_id: conversationId })
    });
    if (!res.ok) return { correctionIds: [] };
    const json = (await res.json()) as {
      correction_ids?: string[];
    };
    return {
      correctionIds: Array.isArray(json.correction_ids)
        ? json.correction_ids.filter((id): id is string => typeof id === "string")
        : []
    };
  } catch (err) {
    console.error("[luna] reflect", err);
    return { correctionIds: [] };
  } finally {
    reflectingConversationIds.delete(conversationId);
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
  feedbackReason?: FeedbackReason | null;
  feedbackNote?: string | null;
  notionSources?: NotionSource[] | null;
  wikiSources?: WikiSourceRef[] | null;
  privateWikiRefs?: WikiSourceRef[] | null;
  cards?: LunaCard[] | null;
  sourceReasons?: LunaSourceReasons | null;
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
  memoryCount?: number | null;
  /** reflect 후 다음 턴에 표시할 정정 후보 칩 */
  correctionCandidateIds?: string[] | null;
  usedPrompts?: UsedPromptRef[] | null;
  classification?: LunaClassificationMeta | null;
  keywords?: string[] | null;
  wsToolCalls?: unknown[] | null;
  connectorRouting?: LunaConnectorRoutingMeta | null;
  intentScore?: number | null;
  confidenceScore?: number | null;
  selfNote?: string | null;
  showAnswerScores?: boolean;
};

export type { LunaSourceReasons };

export type LunaConnectorRoutingMeta = {
  summary: string;
  nas: boolean;
  notion: boolean;
  web: boolean;
  reasonLabel: string;
};

export function normalizeConnectorRouting(raw: unknown): LunaConnectorRoutingMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  if (!summary) return null;
  return {
    summary,
    nas: row.nas === true,
    notion: row.notion === true,
    web: row.web === true,
    reasonLabel:
      typeof row.reason_label === "string"
        ? row.reason_label.trim()
        : typeof row.reasonLabel === "string"
          ? row.reasonLabel.trim()
          : ""
  };
}

export function normalizeSourceReasons(raw: unknown): LunaSourceReasons | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const next: LunaSourceReasons = {};
  for (const key of ["notion", "nas", "web"] as const) {
    if (typeof row[key] === "string") {
      const v = row[key].trim().replace(/\s+/g, " ");
      if (v) next[key] = v.length > 40 ? v.slice(0, 40) : v;
    }
  }
  return Object.keys(next).length > 0 ? next : null;
}

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
        description: typeof row.description === "string" ? row.description : "",
        drive: typeof row.drive === "string" ? row.drive : undefined,
        raw_path: typeof row.raw_path === "string" ? row.raw_path : undefined,
        is_file: typeof row.is_file === "boolean" ? row.is_file : undefined
      };
    });
  return cards.length > 0 ? cards : null;
}

export function normalizeNotionSources(raw: unknown): NotionSource[] | null {
  if (!Array.isArray(raw)) return null;
  const sources = raw
    .filter(
      (s): s is {
        title: string;
        url: string;
        id?: string;
        last_edited_time?: string | null;
        excerpt?: string | null;
        paths?: unknown;
        dates?: unknown;
        entities?: unknown;
        section?: string | null;
        hierarchy?: string | null;
        nas_path?: string | null;
        similarity?: number;
        parent_id?: string | null;
        path_titles?: unknown;
      } =>
        Boolean(s) &&
        typeof s === "object" &&
        typeof (s as { title?: unknown }).title === "string" &&
        typeof (s as { url?: unknown }).url === "string"
    )
    .map((s) => ({
      title: s.title,
      url: s.url,
      id: typeof s.id === "string" ? s.id : "",
      ...(s.last_edited_time !== undefined
        ? { last_edited_time: s.last_edited_time }
        : {}),
      ...(typeof s.excerpt === "string" ? { excerpt: s.excerpt } : {}),
      ...(Array.isArray(s.paths)
        ? { paths: s.paths.filter((p): p is string => typeof p === "string") }
        : {}),
      ...(Array.isArray(s.dates)
        ? { dates: s.dates.filter((d): d is string => typeof d === "string") }
        : {}),
      ...(Array.isArray(s.entities)
        ? { entities: s.entities.filter((e): e is string => typeof e === "string") }
        : {}),
      ...(typeof s.section === "string" ? { section: s.section } : {}),
      ...(typeof s.hierarchy === "string" ? { hierarchy: s.hierarchy } : {}),
      ...(typeof s.nas_path === "string" ? { nas_path: s.nas_path } : {}),
      ...(typeof s.similarity === "number" ? { similarity: s.similarity } : {}),
      ...(typeof s.parent_id === "string" ? { parent_id: s.parent_id } : {}),
      ...(Array.isArray(s.path_titles)
        ? {
            path_titles: s.path_titles.filter(
              (t): t is string => typeof t === "string"
            )
          }
        : {})
    }));
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
    .map((t): LunaAnalysisTeam => {
      const kindRaw = (t as { kind?: unknown }).kind;
      const kind: LunaAnalysisTeam["kind"] =
        kindRaw === "role" || kindRaw === "perspective" ? kindRaw : undefined;
      return { id: t.id, title: t.title, content: t.content, kind };
    });
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
      teamKind?: "perspective" | "role";
    }
  | {
      kind: "meta";
      buffer: string;
      cards: LunaCard[] | null;
      notionSources: NotionSource[] | null;
      wikiSources: WikiSourceRef[] | null;
      sourceReasons: LunaSourceReasons | null;
      mode: "analysis" | null;
      teams: LunaAnalysisTeam[] | null;
      searchRounds: number | null;
      steps: LunaProgressStep[] | null;
      memoryCount: number | null;
      usedPrompts: UsedPromptRef[] | null;
      connectorRouting: LunaConnectorRoutingMeta | null;
      classification: LunaClassificationMeta | null;
    }
  | {
      kind: "ids";
      buffer: string;
      userMessageId: string;
      assistantMessageId: string;
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
    if (parsed.type === "ids") {
      const userMessageId =
        typeof parsed.user_message_id === "string" ? parsed.user_message_id.trim() : "";
      const assistantMessageId =
        typeof parsed.assistant_message_id === "string"
          ? parsed.assistant_message_id.trim()
          : "";
      if (userMessageId && assistantMessageId) {
        return {
          kind: "ids",
          buffer: rest,
          userMessageId,
          assistantMessageId
        };
      }
    }
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
        const teamKind =
          parsed.kind === "role" || parsed.kind === "perspective"
            ? parsed.kind
            : undefined;
        return {
          kind: "team",
          buffer: rest,
          id: parsed.id,
          title: parsed.title,
          status,
          content:
            typeof parsed.content === "string" ? parsed.content : undefined,
          teamKind
        };
      }
    }
    if (parsed.type === "meta") {
      const roundsRaw = parsed.search_rounds;
      const searchRounds =
        typeof roundsRaw === "number" && Number.isFinite(roundsRaw)
          ? roundsRaw
          : typeof roundsRaw === "string" && roundsRaw.trim() !== ""
            ? Number(roundsRaw)
            : null;
      const memRaw = parsed.memory_count;
      const memoryCount =
        typeof memRaw === "number" && Number.isFinite(memRaw)
          ? memRaw
          : typeof memRaw === "string" && memRaw.trim() !== ""
            ? Number(memRaw)
            : null;
      return {
        kind: "meta",
        buffer: rest,
        cards: normalizeLunaCards(parsed.cards),
        notionSources: normalizeNotionSources(parsed.notion_sources),
        wikiSources: normalizeWikiSources(parsed.wiki_sources),
        sourceReasons: normalizeSourceReasons(parsed.source_reasons),
        mode: parsed.mode === "analysis" ? "analysis" : null,
        teams: normalizeAnalysisTeams(parsed.teams),
        searchRounds:
          searchRounds != null && Number.isFinite(searchRounds)
            ? searchRounds
            : null,
        steps: normalizeProgressSteps(parsed.steps),
        memoryCount:
          memoryCount != null && Number.isFinite(memoryCount)
            ? memoryCount
            : null,
        usedPrompts: normalizeUsedPrompts(parsed.used_prompts),
        connectorRouting: normalizeConnectorRouting(parsed.connector_routing),
        classification: normalizeClassification(parsed.classification)
      };
    }
  } catch {
    /* 잘못된 JSON 줄은 무시 */
  }

  return consumeLunaStreamEvents(rest, false);
}

export function buildSearchStatus(_connectors: LunaConnectorsState): string[] {
  return [];
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
  onNewChat?: () => void;
  onOpenMenu?: () => void;
  sending?: boolean;
  showMobileHeader?: boolean;
  onEnsureConversation: () => Promise<string | null>;
  onRenameTitle?: (title: string) => void | Promise<void>;
  /** reflect 가 정정 후보를 만들면, 다음 답변 칩용으로 전달 */
  onReflectCorrections?: (candidateIds: string[]) => void;
  onClearCorrection?: (messageId: string, candidateId: string) => void;
  initialDraft?: string;
};

export function LunaChat({
  conversation,
  messages,
  onSend,
  onSuggestion: _onSuggestion,
  onNewChat,
  onOpenMenu,
  sending,
  showMobileHeader,
  onEnsureConversation,
  onRenameTitle,
  onReflectCorrections,
  onClearCorrection,
  initialDraft
}: LunaChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomUiRef = useRef<HTMLDivElement>(null);
  const reflectStateRef = useRef<{ id: string; messageCount: number } | null>(null);
  const onReflectCorrectionsRef = useRef(onReflectCorrections);
  onReflectCorrectionsRef.current = onReflectCorrections;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const skipTitleCommitRef = useRef(false);
  const stickToBottomRef = useRef(true);
  useMeasureBottomUi(bottomUiRef, true);
  const [nasDriveMode, setNasDriveMode] =
    useState<LunaNasDriveMode>(() => loadNasDriveMode());

  function handleNasDriveModeChange(mode: LunaNasDriveMode) {
    setNasDriveMode(mode);
    saveNasDriveMode(mode);
  }
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showQuestionCard, setShowQuestionCard] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const NEAR_BOTTOM_PX = 40;

  function scrollMessagesToBottom() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function forceStickToBottom() {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      requestAnimationFrame(scrollMessagesToBottom);
    });
  }

  function handleMessagesScroll() {
    const el = listRef.current;
    if (!el) return;
    const distance =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance <= NEAR_BOTTOM_PX;
    stickToBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }
  const {
    pendingQuestion,
    busy: questionBusy,
    error: questionError,
    answeredContent,
    answeredMessage,
    submitAnswer,
    clearAnswered
  } = useLunaPendingQuestion(Boolean(showMobileHeader));
  const title = conversation?.title ?? "새 대화";
  const hasPendingQuestion = Boolean(pendingQuestion);

  const activeClarify = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.isThinking || m.metadata?.isThinking) continue;
      if (m.role === "user") return null;
      if (m.role === "assistant" && m.clarify?.options && m.clarify.options.length >= 2) {
        return {
          question: m.clarify.question || m.content,
          options: m.clarify.options
        };
      }
      if (m.role === "assistant" && m.content) {
        const parsed = parseNumberedChoices(m.content);
        if (parsed) {
          return { question: parsed.body, options: parsed.options };
        }
      }
    }
    return null;
  }, [messages]);

  const emptySkills = {
    perspective_ids: [] as string[],
    role_ids: [] as string[],
    task_ids: [] as string[]
  };

  function sendChoice(text: string) {
    forceStickToBottom();
    onSend(text, { notion: false, web: false, nas: false }, [], [], emptySkills);
  }

  function handleSendWrapped(
    message: string,
    nextConnectors: LunaConnectorsState,
    attachmentIds: string[],
    attachmentMeta: LunaAttachmentRef[],
    skills: LunaSkillsSelection
  ) {
    if (activeClarify) {
      const resolved = resolveChoiceInput(message, activeClarify.options);
      if (resolved.kind === "other") {
        setFocusTick((n) => n + 1);
        return;
      }
      if (resolved.kind === "option") {
        forceStickToBottom();
        onSend(resolved.text, nextConnectors, attachmentIds, attachmentMeta, skills);
        return;
      }
    }
    forceStickToBottom();
    onSend(message, nextConnectors, attachmentIds, attachmentMeta, skills);
  }

  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(title);
  }, [conversation?.id, title]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  function beginEditTitle() {
    if (!conversation || !onRenameTitle) return;
    skipTitleCommitRef.current = false;
    setTitleDraft(title);
    setEditingTitle(true);
  }

  async function commitTitleEdit() {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false;
      return;
    }
    if (!editingTitle) return;
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) return;
    await onRenameTitle?.(next);
  }

  function cancelTitleEdit() {
    skipTitleCommitRef.current = true;
    setEditingTitle(false);
    setTitleDraft(title);
  }

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(scrollMessagesToBottom);
  }, [conversation?.id]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollMessagesToBottom();
  }, [messages, sending]);

  useEffect(() => {
    const nextId = conversation?.id ?? null;
    const count = messages.filter(
      (m) => !(m.isThinking === true || m.metadata?.isThinking === true)
    ).length;
    const prev = reflectStateRef.current;

    const fireReflect = (id: string) => {
      void callReflect(id).then((r) => {
        if (r.correctionIds.length > 0) {
          onReflectCorrectionsRef.current?.(r.correctionIds);
        }
      });
    };

    if (prev && prev.id !== nextId && prev.messageCount >= 2) {
      // 같은 leave에 unmount cleanup 이 한 번 더 못 타게 카운트 소진
      reflectStateRef.current = { id: prev.id, messageCount: 0 };
      fireReflect(prev.id);
    }

    if (nextId) {
      reflectStateRef.current = { id: nextId, messageCount: count };
    } else if (prev && prev.messageCount >= 2) {
      fireReflect(prev.id);
      reflectStateRef.current = null;
    } else if (!nextId) {
      reflectStateRef.current = null;
    }
  }, [conversation?.id, messages]);

  // unmount 전용 — onReflectCorrections 의존 금지(매 렌더 cleanup → 폭주 원인)
  useEffect(() => {
    return () => {
      const prev = reflectStateRef.current;
      if (prev && prev.messageCount >= 2) {
        reflectStateRef.current = { id: prev.id, messageCount: 0 };
        void callReflect(prev.id).then((r) => {
          if (r.correctionIds.length > 0) {
            onReflectCorrectionsRef.current?.(r.correctionIds);
          }
        });
      }
    };
  }, []);

  const isEmpty = messages.length === 0 && !sending;

  const titleNode = editingTitle ? (
    <input
      ref={titleInputRef}
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={() => void commitTitleEdit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commitTitleEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelTitleEdit();
        }
      }}
      className="w-full rounded border border-[#534AB7] px-1.5 py-0.5 text-[14.5px] font-semibold text-slate-900 outline-none"
    />
  ) : (
    <button
      type="button"
      onDoubleClick={beginEditTitle}
      className="chip-sm block w-full truncate text-left text-[14.5px] font-semibold text-slate-900"
      title="더블클릭하여 이름 변경"
    >
      {title}
    </button>
  );

  return (
    <ChatShellChrome
      className="max-md:bg-[#F5F4F1]"
      headerLeft={
        showMobileHeader ? (
          <button
            type="button"
            onClick={onOpenMenu}
            className="chip-sm flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-[#6b6f76]"
            aria-label="메뉴"
          >
            <Menu size={16} strokeWidth={1.75} aria-hidden />
          </button>
        ) : undefined
      }
      headerTitle={showMobileHeader ? titleNode : <span className="sr-only">{title}</span>}
      headerRight={
        showMobileHeader ? (
          <button
            type="button"
            onClick={onNewChat}
            className="chip-sm flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-[#6b6f76]"
            aria-label="새 대화"
          >
            <SquarePen size={16} strokeWidth={1.75} aria-hidden />
          </button>
        ) : undefined
      }
      desktopHeader={
        <div className="flex items-center border-b border-slate-200 px-5 py-3">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitTitleEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelTitleEdit();
                }
              }}
              className="w-full max-w-md rounded border border-[#534AB7] px-2 py-1 text-base font-semibold text-slate-900 outline-none"
            />
          ) : (
            <h1
              className="truncate text-base font-semibold text-slate-900"
              onDoubleClick={beginEditTitle}
              title="더블클릭하여 이름 변경"
            >
              {title}
            </h1>
          )}
        </div>
      }
      messagesRef={listRef}
      onMessagesScroll={handleMessagesScroll}
      bodyOverlay={
        showJumpToLatest ? (
          <button
            type="button"
            onClick={() => forceStickToBottom()}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-700 shadow-md transition hover:bg-slate-50"
          >
            새 메시지 ↓
          </button>
        ) : null
      }
      footerRef={bottomUiRef}
      footer={
        <div className="w-full">
          {activeClarify ? (
            <div className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <p className="mb-2 text-[11px] font-medium text-slate-600">
                루나의 질문 — 선택하거나 번호를 입력하세요
              </p>
              <ul className="space-y-1">
                {activeClarify.options.map((opt, idx) => {
                  const isOther = /기타/.test(opt);
                  return (
                    <li key={`${idx}-${opt}`}>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          if (isOther) {
                            setFocusTick((n) => n + 1);
                            return;
                          }
                          sendChoice(opt);
                        }}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-slate-800 transition hover:bg-[#EEEDFE] disabled:opacity-50"
                      >
                        <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-[#534AB7] px-1 text-[11px] font-semibold text-white">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1 leading-snug">{opt}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <LunaInput
            onSend={handleSendWrapped}
            disabled={sending}
            conversationId={conversation?.id ?? null}
            onEnsureConversation={onEnsureConversation}
            focusTick={focusTick}
            initialDraft={initialDraft}
          />
        </div>
      }
    >
      {showQuestionCard ? (
        <LunaInlineQuestionCard
          question={pendingQuestion}
          answeredMessage={answeredMessage}
          answeredContent={answeredContent}
          busy={questionBusy}
          error={questionError}
          onAnswer={async (answer) => {
            await submitAnswer(answer);
          }}
          onDismiss={() => setShowQuestionCard(false)}
          onCloseAnswered={() => {
            clearAnswered();
            setShowQuestionCard(false);
          }}
        />
      ) : null}
      {isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <img
            src="/luna/luna-play.webp"
            alt="루나"
            width={140}
            height={140}
            draggable={false}
            style={{
              display: "block",
              margin: "0 auto",
              pointerEvents: "none"
            }}
          />
          <p
            className="mb-6 text-base font-medium text-slate-800"
            style={{ marginTop: 12 }}
          >
            안녕하세요, 저는 루나입니다
          </p>
          <div className="flex w-full max-w-md flex-col gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={sending}
                onClick={() =>
                  onSend(s, { notion: false, web: false, nas: false }, [], [], {
                    perspective_ids: [],
                    role_ids: [],
                    task_ids: []
                  })
                }
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition hover:border-[#534AB7]/40 hover:bg-[#EEEDFE]/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="pb-2">
          {messages.map((m, index) => {
            const isThinking =
              m.isThinking === true || m.metadata?.isThinking === true;
            const detailMeta: LunaDetailMeta = {
              modelSteps: m.modelSteps,
              steps: m.steps,
              wsSearches: m.wsToolCalls,
              connectorRouting: m.connectorRouting
            };
            const prevUser = [...messages.slice(0, index)]
              .reverse()
              .find((x) => x.role === "user");
            return (
              <LunaMessage
                key={m.id}
                id={m.id}
                role={m.role}
                content={m.content}
                engine={m.engine}
                feedback={m.feedback}
                feedbackReason={m.feedbackReason}
                feedbackNote={m.feedbackNote}
                notionSources={m.notionSources}
                wikiSources={m.wikiSources}
                privateWikiRefs={m.privateWikiRefs}
                cards={m.cards}
                sourceReasons={m.sourceReasons}
                queryHint={
                  m.role === "assistant" && prevUser?.content
                    ? hintFromUserQuery(prevUser.content)
                    : null
                }
                nasDriveMode={nasDriveMode}
                onNasDriveModeChange={handleNasDriveModeChange}
                attachments={m.attachments}
                isThinking={isThinking}
                modelLabel={m.modelLabel}
                durationMs={m.durationMs}
                modelSteps={m.modelSteps}
                steps={m.steps}
                clarify={m.clarify}
                mode={m.mode}
                teams={m.teams}
                memoryCount={m.memoryCount}
                usedPrompts={m.usedPrompts}
                classification={m.classification}
                detailMeta={detailMeta}
                intentScore={m.intentScore}
                confidenceScore={m.confidenceScore}
                selfNote={m.selfNote}
                showAnswerScores={m.showAnswerScores}
                correctionCandidateIds={m.correctionCandidateIds}
                hideInlineClarifyOptions
                onCorrectionCancel={
                  onClearCorrection
                    ? (candidateId) => onClearCorrection(m.id, candidateId)
                    : undefined
                }
                onClarifySelect={undefined}
              />
            );
          })}
        </div>
      )}
    </ChatShellChrome>
  );
}
