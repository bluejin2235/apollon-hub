"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addThinkingMessage,
  buildSearchStatus,
  consumeLunaStreamEvents,
  LunaChat,
  normalizeAnalysisTeams,
  normalizeClarify,
  normalizeLunaCards,
  normalizeModelSteps,
  normalizeNotionSources,
  normalizeProgressSteps,
  removeThinkingMessage,
  THINKING_MESSAGE_ID,
  type LunaAnalysisTeam,
  type LunaChatMessage
} from "@/components/luna/LunaChat";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type {
  LunaAttachmentRef,
  LunaConnectorsState,
  LunaSkillsSelection
} from "@/components/luna/LunaInput";
import { LunaSidebar, type LunaConversation } from "@/components/luna/LunaSidebar";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const EMPTY_SKILLS: LunaSkillsSelection = {
  perspective_ids: [],
  task_ids: []
};

const DEFAULT_CONNECTORS: LunaConnectorsState = {
  notion: false,
  web: false,
  nas: false
};

export default function LunaPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<LunaConversation[]>([]);
  const [messages, setMessages] = useState<LunaChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const visibleConversations = useMemo(() => {
    if (!selectedProjectId) return conversations;
    return conversations.filter((c) => c.project_id === selectedProjectId);
  }, [conversations, selectedProjectId]);

  const selectedConversation =
    conversations.find((c) => c.id === selectedConversationId) ?? null;

  const loadConversations = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setConversations([]);
      setLoadingList(false);
      return;
    }

    const res = await fetch("/api/luna/conversations", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error("[luna] conversations", await res.text());
      setLoadingList(false);
      return;
    }
    const json = (await res.json()) as { conversations?: LunaConversation[] };
    setConversations(json.conversations ?? []);
    setLoadingList(false);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("luna_messages")
      .select("id, role, content, engine, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[luna] messages", error);
      setMessages([]);
      return;
    }

    setMessages(
      (data ?? []).map((row) => {
        const meta =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : null;
        const fb = meta?.feedback;
        const feedback = fb === "good" || fb === "bad" ? fb : null;
        const rawSources = meta?.notion_sources;
        let notionSources: { title: string; url: string }[] | null = null;
        if (Array.isArray(rawSources)) {
          notionSources = rawSources
            .filter(
              (s): s is { title: string; url: string } =>
                Boolean(s) &&
                typeof s === "object" &&
                typeof (s as { title?: unknown }).title === "string" &&
                typeof (s as { url?: unknown }).url === "string"
            )
            .map((s) => ({ title: s.title, url: s.url }));
        }
        let attachments: LunaAttachmentRef[] | null = null;
        const rawAttachments = meta?.attachments;
        if (Array.isArray(rawAttachments)) {
          attachments = rawAttachments
            .filter(
              (a): a is LunaAttachmentRef =>
                Boolean(a) &&
                typeof a === "object" &&
                typeof (a as { id?: unknown }).id === "string" &&
                typeof (a as { file_name?: unknown }).file_name === "string" &&
                typeof (a as { mime_type?: unknown }).mime_type === "string"
            )
            .map((a) => ({
              id: a.id,
              file_name: a.file_name,
              mime_type: a.mime_type
            }));
          if (attachments.length === 0) attachments = null;
        }

        const modelLabel =
          typeof meta?.model_label === "string" ? meta.model_label : null;
        const durationMs =
          typeof meta?.duration_ms === "number" ? meta.duration_ms : null;
        const searchRounds =
          typeof meta?.search_rounds === "number" ? meta.search_rounds : null;
        const clarify = normalizeClarify(meta?.clarify);
        const mode = meta?.mode === "analysis" ? ("analysis" as const) : null;
        const teams = normalizeAnalysisTeams(meta?.teams);

        return {
          id: row.id as string,
          role: row.role as "user" | "assistant",
          content: row.content as string,
          engine: (row.engine as string | null) ?? null,
          feedback,
          notionSources: normalizeNotionSources(meta?.notion_sources) ?? notionSources,
          cards: normalizeLunaCards(meta?.cards),
          attachments,
          modelLabel,
          durationMs,
          modelSteps: normalizeModelSteps(meta?.model_steps),
          steps: normalizeProgressSteps(meta?.steps),
          searchRounds,
          clarify,
          mode,
          teams
        };
      })
    );
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedConversationId);
  }, [selectedConversationId, loadMessages]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const stillVisible = visibleConversations.some((c) => c.id === selectedConversationId);
    if (!stillVisible) {
      setSelectedConversationId(null);
      setMessages([]);
    }
  }, [selectedConversationId, visibleConversations]);

  const onSelectProject = useCallback((id: string | null) => {
    setSelectedProjectId(id);
  }, []);

  const onNewChat = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/luna/conversations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        selectedProjectId ? { project_id: selectedProjectId } : {}
      )
    });
    if (!res.ok) {
      console.error("[luna] create conversation", await res.text());
      return;
    }
    const json = (await res.json()) as { conversation: LunaConversation };
    setConversations((prev) => [json.conversation, ...prev]);
    setSelectedConversationId(json.conversation.id);
    setMessages([]);
  }, [selectedProjectId]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (selectedConversationId) return selectedConversationId;
    const token = await getAccessToken();
    if (!token) return null;
    const createRes = await fetch("/api/luna/conversations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        selectedProjectId ? { project_id: selectedProjectId } : {}
      )
    });
    if (!createRes.ok) {
      console.error("[luna] create conversation", await createRes.text());
      return null;
    }
    const created = (await createRes.json()) as { conversation: LunaConversation };
    setConversations((prev) => [created.conversation, ...prev]);
    setSelectedConversationId(created.conversation.id);
    return created.conversation.id;
  }, [selectedConversationId, selectedProjectId]);

  const sendMessage = useCallback(
    async (
      text: string,
      connectors: LunaConnectorsState = DEFAULT_CONNECTORS,
      attachmentIds: string[] = [],
      attachmentMeta: LunaAttachmentRef[] = [],
      skills: LunaSkillsSelection = EMPTY_SKILLS
    ) => {
      const conversationId = await ensureConversation();
      const token = await getAccessToken();
      if (!token || !conversationId) return;
      if (!text.trim() && attachmentIds.length === 0) return;

      const userTempId = `temp-user-${Date.now()}`;
      const assistantTempId = `temp-assistant-${Date.now()}`;

      setMessages((prev) =>
        addThinkingMessage([
          ...prev,
          {
            id: userTempId,
            role: "user",
            content: text,
            attachments: attachmentMeta.length > 0 ? attachmentMeta : null
          }
        ])
      );
      setSearchStatus(
        attachmentIds.length > 0 ? ["문서 분석 중..."] : buildSearchStatus(connectors)
      );
      setSending(true);

      try {
        const res = await fetch("/api/luna/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            message: text,
            connectors,
            skills,
            ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {})
          })
        });

        if (!res.ok || !res.body) {
          const errText = await res.text();
          console.error("[luna] chat", errText);
          setSearchStatus([]);
          setMessages((prev) => [
            ...removeThinkingMessage(prev),
            {
              id: assistantTempId,
              role: "assistant",
              content: "응답을 가져오지 못했습니다. 다시 시도해 주세요."
            }
          ]);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let metaReceived = false;
        let streamEndedByClarify = false;
        let streamCards: LunaChatMessage["cards"] = null;
        let streamNotionSources: LunaChatMessage["notionSources"] = null;
        let streamSteps: LunaProgressStep[] = [];
        let streamMode: LunaChatMessage["mode"] = null;
        let streamTeams: LunaAnalysisTeam[] = [];
        let assistantContent = "";
        let assistantVisible = false;

        const updateThinking = (extra?: Partial<LunaChatMessage>) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === THINKING_MESSAGE_ID || m.isThinking
                ? {
                    ...m,
                    steps: streamSteps.length > 0 ? [...streamSteps] : m.steps,
                    mode: streamMode ?? m.mode,
                    teams: streamTeams.length > 0 ? [...streamTeams] : m.teams,
                    ...extra
                  }
                : m
            )
          );
        };

        const upsertAssistant = (content: string, extra?: Partial<LunaChatMessage>) => {
          setMessages((prev) => {
            const base = removeThinkingMessage(prev);
            const existing = base.some((m) => m.id === assistantTempId);
            const next: LunaChatMessage = {
              id: assistantTempId,
              role: "assistant",
              content,
              cards: streamCards,
              notionSources: streamNotionSources,
              steps: streamSteps.length > 0 ? streamSteps : null,
              mode: streamMode,
              teams: streamTeams.length > 0 ? streamTeams : null,
              ...extra
            };
            if (existing) {
              return base.map((m) =>
                m.id === assistantTempId ? { ...m, ...next } : m
              );
            }
            return [...base, next];
          });
          assistantVisible = true;
        };

        const applyTeamEvent = (ev: {
          id: string;
          title: string;
          status: "running" | "done";
          content?: string;
        }) => {
          streamMode = "analysis";
          const idx = streamTeams.findIndex((t) => t.id === ev.id);
          const next: LunaAnalysisTeam = {
            id: ev.id,
            title: ev.title,
            content:
              ev.status === "done"
                ? (ev.content ?? "")
                : idx >= 0
                  ? streamTeams[idx]!.content
                  : ""
          };
          if (idx >= 0) streamTeams[idx] = next;
          else streamTeams.push(next);
          if (assistantVisible) {
            upsertAssistant(assistantContent);
          } else {
            updateThinking();
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          if (!metaReceived) {
            let keepParsing = true;
            while (keepParsing) {
              const consumed = consumeLunaStreamEvents(buffer, false);
              if (consumed.kind === "need_more") {
                buffer = consumed.buffer;
                keepParsing = false;
                continue;
              }
              if (consumed.kind === "step") {
                buffer = consumed.buffer;
                const idx = streamSteps.findIndex((s) => s.key === consumed.step.key);
                if (idx >= 0) streamSteps[idx] = consumed.step;
                else streamSteps.push(consumed.step);
                updateThinking();
                continue;
              }
              if (consumed.kind === "team") {
                buffer = consumed.buffer;
                applyTeamEvent(consumed);
                continue;
              }
              if (consumed.kind === "clarify") {
                buffer = consumed.buffer;
                setSearchStatus([]);
                upsertAssistant(consumed.question, {
                  clarify: {
                    question: consumed.question,
                    options: consumed.options
                  },
                  isThinking: false
                });
                streamEndedByClarify = true;
                keepParsing = false;
                break;
              }
              if (consumed.kind === "meta") {
                streamCards = consumed.cards;
                streamNotionSources = consumed.notionSources;
                if (consumed.mode === "analysis") streamMode = "analysis";
                if (consumed.teams && consumed.teams.length > 0) {
                  streamTeams = consumed.teams;
                }
                setSearchStatus([]);
                metaReceived = true;
                buffer = consumed.buffer;
                assistantContent = buffer;
                upsertAssistant(assistantContent, { isThinking: false });
                keepParsing = false;
                continue;
              }
              // 알 수 없는 줄은 파서가 이미 스킵
              buffer = consumed.buffer;
            }
            if (streamEndedByClarify) break;
            continue;
          }

          assistantContent = buffer;
          upsertAssistant(assistantContent);
        }

        if (!assistantVisible && !streamEndedByClarify) {
          setMessages((prev) => [
            ...removeThinkingMessage(prev),
            {
              id: assistantTempId,
              role: "assistant",
              content: "응답을 가져오지 못했습니다. 다시 시도해 주세요."
            }
          ]);
        }

        await loadConversations();
        await loadMessages(conversationId);
      } catch (err) {
        console.error("[luna] chat stream", err);
        setSearchStatus([]);
        setMessages((prev) => {
          const withoutThinking = removeThinkingMessage(prev);
          const existing = withoutThinking.find((m) => m.id === assistantTempId);
          if (existing) {
            return withoutThinking.map((m) =>
              m.id === assistantTempId
                ? { ...m, content: m.content || "오류가 발생했습니다." }
                : m
            );
          }
          return [
            ...withoutThinking,
            {
              id: assistantTempId,
              role: "assistant",
              content: "오류가 발생했습니다."
            }
          ];
        });
      } finally {
        setSending(false);
        setSearchStatus([]);
      }
    },
    [ensureConversation, loadConversations, loadMessages]
  );

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      {/* PC 사이드바 */}
      <div className="hidden h-full p-2 md:flex">
        <LunaSidebar
          conversations={visibleConversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          onNewChat={() => void onNewChat()}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
        />
      </div>

      {/* 모바일: 목록 */}
      <div
        className={`h-full w-full p-2 md:hidden ${
          selectedConversationId ? "hidden" : "flex"
        }`}
      >
        <LunaSidebar
          conversations={visibleConversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          onNewChat={() => void onNewChat()}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
        />
      </div>

      {/* 채팅: PC 항상 / 모바일은 선택 시 */}
      <div
        className={`min-h-0 min-w-0 flex-1 flex-col ${
          selectedConversationId ? "flex" : "hidden md:flex"
        }`}
      >
        {loadingList && !selectedConversation ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            불러오는 중…
          </div>
        ) : (
          <LunaChat
            conversation={selectedConversation}
            messages={messages}
            onSend={(text, connectors, attachmentIds, attachmentMeta, skills) =>
              void sendMessage(text, connectors, attachmentIds, attachmentMeta, skills)
            }
            onSuggestion={(text) => void sendMessage(text, DEFAULT_CONNECTORS, [], [], EMPTY_SKILLS)}
            onBack={() => setSelectedConversationId(null)}
            sending={sending}
            searchStatus={searchStatus}
            showMobileHeader={Boolean(selectedConversationId)}
            onEnsureConversation={ensureConversation}
          />
        )}
      </div>
    </div>
  );
}
