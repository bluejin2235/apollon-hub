"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  normalizeSourceReasons,
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
import { LunaShell } from "@/components/luna/LunaShell";
import { LunaSidebar, type LunaConversation } from "@/components/luna/LunaSidebar";
import { parseNumberedChoices } from "@/lib/luna/chat-response";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const EMPTY_SKILLS: LunaSkillsSelection = {
  perspective_ids: [],
  role_ids: [],
  task_ids: []
};

const DEFAULT_CONNECTORS: LunaConnectorsState = {
  notion: true,
  web: true,
  nas: true
};

export default function LunaPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<LunaConversation[]>([]);
  const [messages, setMessages] = useState<LunaChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pendingCorrectionIdsRef = useRef<string[]>([]);
  const askedRef = useRef(false);

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
        const roundsRaw = meta?.search_rounds;
        let searchRounds: number | null = null;
        if (typeof roundsRaw === "number" && Number.isFinite(roundsRaw)) {
          searchRounds = roundsRaw;
        } else if (typeof roundsRaw === "string" && roundsRaw.trim() !== "") {
          const n = Number(roundsRaw);
          if (Number.isFinite(n)) searchRounds = n;
        }
        const clarify = normalizeClarify(meta?.clarify);
        const mode = meta?.mode === "analysis" ? ("analysis" as const) : null;
        const teams = normalizeAnalysisTeams(meta?.teams);
        const memRaw = meta?.memory_count;
        let memoryCount: number | null = null;
        if (typeof memRaw === "number" && Number.isFinite(memRaw)) {
          memoryCount = memRaw;
        } else if (typeof memRaw === "string" && memRaw.trim() !== "") {
          const n = Number(memRaw);
          if (Number.isFinite(n)) memoryCount = n;
        }

        // 본문에 번호 선택지가 남아 있으면 clarify 로 승격 (패널용)
        let content = row.content as string;
        let clarifyResolved = clarify;
        if (!clarifyResolved && row.role === "assistant") {
          const numbered = parseNumberedChoices(content);
          if (numbered) {
            content = numbered.body;
            clarifyResolved = {
              question: numbered.body,
              options: numbered.options
            };
          }
        }

        return {
          id: row.id as string,
          role: row.role as "user" | "assistant",
          content,
          engine: (row.engine as string | null) ?? null,
          feedback,
          notionSources: normalizeNotionSources(meta?.notion_sources) ?? notionSources,
          cards: normalizeLunaCards(meta?.cards),
          sourceReasons: normalizeSourceReasons(meta?.source_reasons),
          attachments,
          modelLabel,
          durationMs,
          modelSteps: normalizeModelSteps(meta?.model_steps),
          steps: normalizeProgressSteps(meta?.steps),
          searchRounds,
          clarify: clarifyResolved,
          mode,
          teams,
          memoryCount
        };
      })
    );
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // /glossary 사이드바에서 넘어올 때 ?c= · ?project= 로 방을 지정한다
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("c");
    const projectId = params.get("project");
    if (conversationId) setSelectedConversationId(conversationId);
    if (projectId) setSelectedProjectId(projectId);
  }, []);

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

  const onRenameConversation = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/luna/conversations", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, title: trimmed })
      });
      if (!res.ok) {
        console.error("[luna] rename", await res.text());
        return;
      }
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c))
      );
    },
    []
  );

  const onDeleteConversation = useCallback(
    async (id: string) => {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/luna/conversations", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        console.error("[luna] delete", await res.text());
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (selectedConversationId === id) {
        setSelectedConversationId(null);
        setMessages([]);
      }
    },
    [selectedConversationId]
  );

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
        let streamSourceReasons: LunaChatMessage["sourceReasons"] = null;
        let streamSteps: LunaProgressStep[] = [];
        let streamMode: LunaChatMessage["mode"] = null;
        let streamTeams: LunaAnalysisTeam[] = [];
        let streamSearchRounds: number | null = null;
        let streamMemoryCount: number | null = null;
        let assistantContent = "";
        let assistantVisible = false;

        const updateThinking = (extra?: Partial<LunaChatMessage>) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === THINKING_MESSAGE_ID || m.isThinking
                ? {
                    ...m,
                    steps: streamSteps.length > 0 ? [...streamSteps] : m.steps,
                    searchRounds: streamSearchRounds ?? m.searchRounds,
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
              sourceReasons: streamSourceReasons,
              steps: streamSteps.length > 0 ? streamSteps : null,
              searchRounds: streamSearchRounds,
              mode: streamMode,
              teams: streamTeams.length > 0 ? streamTeams : null,
              memoryCount: streamMemoryCount,
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
          teamKind?: "perspective" | "role";
        }) => {
          streamMode = "analysis";
          const idx = streamTeams.findIndex((t) => t.id === ev.id);
          const next: LunaAnalysisTeam = {
            id: ev.id,
            title: ev.title,
            kind: ev.teamKind ?? (idx >= 0 ? streamTeams[idx]!.kind : undefined),
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
                streamSourceReasons = consumed.sourceReasons;
                streamMemoryCount = consumed.memoryCount;
                if (consumed.mode === "analysis") streamMode = "analysis";
                if (consumed.teams && consumed.teams.length > 0) {
                  streamTeams = consumed.teams;
                }
                if (consumed.searchRounds != null) {
                  streamSearchRounds = consumed.searchRounds;
                }
                if (consumed.steps && consumed.steps.length > 0) {
                  streamSteps = consumed.steps;
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

        // meta 이후 step 이벤트는 텍스트로 섞이므로, 스트림 종료 시 answer 완료 반영
        if (assistantVisible && !streamEndedByClarify) {
          const answerIdx = streamSteps.findIndex((s) => s.key === "answer");
          if (answerIdx >= 0 && streamSteps[answerIdx]!.status !== "done") {
            streamSteps[answerIdx] = {
              ...streamSteps[answerIdx]!,
              status: "done",
              label: "정리 완료"
            };
          }
          const numbered = parseNumberedChoices(assistantContent);
          if (numbered) {
            upsertAssistant(numbered.body, {
              isThinking: false,
              clarify: {
                question: numbered.body,
                options: numbered.options
              }
            });
          } else {
            upsertAssistant(assistantContent, { isThinking: false });
          }
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

        try {
          await fetch("/api/luna/conversations/title", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ conversation_id: conversationId })
          });
        } catch (titleErr) {
          console.error("[luna] title", titleErr);
        }
        await loadConversations();
        await loadMessages(conversationId);

        const correctionIds = pendingCorrectionIdsRef.current;
        pendingCorrectionIdsRef.current = [];
        if (correctionIds.length > 0) {
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i -= 1) {
              const m = prev[i]!;
              if (m.role === "assistant" && !m.clarify) {
                const next = [...prev];
                next[i] = {
                  ...m,
                  correctionCandidateIds: correctionIds
                };
                return next;
              }
            }
            return prev;
          });
        }
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

  const selectConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    setDrawerOpen(false);
  }, []);

  // 용어사전의 "루나에게 물어보기" → ?ask= 로 넘어온 질문을 한 번만 보낸다
  useEffect(() => {
    if (askedRef.current) return;
    const question = new URLSearchParams(window.location.search).get("ask");
    if (!question?.trim()) return;
    askedRef.current = true;
    void sendMessage(question.trim(), DEFAULT_CONNECTORS, [], [], EMPTY_SKILLS);
  }, [sendMessage]);

  return (
    <LunaShell
      drawerOpen={drawerOpen}
      onCloseDrawer={() => setDrawerOpen(false)}
      sidebar={
        <LunaSidebar
          conversations={visibleConversations}
          selectedId={selectedConversationId}
          onSelect={selectConversation}
          onNewChat={() => {
            void onNewChat();
            setDrawerOpen(false);
          }}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onRename={onRenameConversation}
          onDelete={onDeleteConversation}
        />
      }
    >
      <>
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
            onSuggestion={(text) =>
              void sendMessage(text, DEFAULT_CONNECTORS, [], [], EMPTY_SKILLS)
            }
            onBack={() => setSelectedConversationId(null)}
            onOpenMenu={() => setDrawerOpen(true)}
            sending={sending}
            searchStatus={searchStatus}
            showMobileHeader
            onEnsureConversation={ensureConversation}
            onRenameTitle={
              selectedConversation
                ? (title) =>
                    void onRenameConversation(selectedConversation.id, title)
                : undefined
            }
            onReflectCorrections={(ids) => {
              pendingCorrectionIdsRef.current = [
                ...pendingCorrectionIdsRef.current,
                ...ids
              ];
            }}
            onClearCorrection={(messageId, candidateId) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        correctionCandidateIds: (m.correctionCandidateIds ?? []).filter(
                          (id) => id !== candidateId
                        )
                      }
                    : m
                )
              );
            }}
          />
        )}
      </>
    </LunaShell>
  );
}
