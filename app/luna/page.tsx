"use client";

import { useCallback, useEffect, useState } from "react";
import { LunaChat, type LunaChatMessage } from "@/components/luna/LunaChat";
import type { LunaEngineOption } from "@/components/luna/LunaInput";
import { LunaSidebar, type LunaConversation } from "@/components/luna/LunaSidebar";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function LunaPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<LunaConversation[]>([]);
  const [messages, setMessages] = useState<LunaChatMessage[]>([]);
  const [engine, setEngine] = useState<LunaEngineOption>("auto");
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

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
      .select("id, role, content, engine, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[luna] messages", error);
      setMessages([]);
      return;
    }

    setMessages(
      (data ?? []).map((row) => ({
        id: row.id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        engine: (row.engine as string | null) ?? null
      }))
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
    if (!selectedConversation) return;
    const e = selectedConversation.engine.toLowerCase();
    if (e === "auto" || e === "claude" || e === "gpt" || e === "gemini") {
      setEngine(e);
    }
  }, [selectedConversation?.id, selectedConversation?.engine]);

  const onNewChat = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/luna/conversations", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error("[luna] create conversation", await res.text());
      return;
    }
    const json = (await res.json()) as { conversation: LunaConversation };
    setConversations((prev) => [json.conversation, ...prev]);
    setSelectedConversationId(json.conversation.id);
    setMessages([]);
    setEngine("auto");
  }, []);

  const onEngineChange = useCallback(
    async (next: LunaEngineOption) => {
      setEngine(next);
      if (!selectedConversationId) return;
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch("/api/luna/conversations", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: selectedConversationId, engine: next })
      });
      if (!res.ok) {
        console.error("[luna] patch engine", await res.text());
        return;
      }
      const json = (await res.json()) as { conversation: LunaConversation };
      setConversations((prev) =>
        prev.map((c) => (c.id === json.conversation.id ? json.conversation : c))
      );
    },
    [selectedConversationId]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      let conversationId = selectedConversationId;

      if (!conversationId) {
        const token = await getAccessToken();
        if (!token) return;
        const createRes = await fetch("/api/luna/conversations", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!createRes.ok) {
          console.error("[luna] create before send", await createRes.text());
          return;
        }
        const created = (await createRes.json()) as { conversation: LunaConversation };
        conversationId = created.conversation.id;
        setConversations((prev) => [created.conversation, ...prev]);
        setSelectedConversationId(conversationId);
      }

      const token = await getAccessToken();
      if (!token || !conversationId) return;

      const userTempId = `temp-user-${Date.now()}`;
      const assistantTempId = `temp-assistant-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        { id: userTempId, role: "user", content: text, engine },
        { id: assistantTempId, role: "assistant", content: "", engine: null }
      ]);
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
            engine
          })
        });

        if (!res.ok || !res.body) {
          const errText = await res.text();
          console.error("[luna] chat", errText);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantTempId
                ? { ...m, content: "응답을 가져오지 못했습니다. 다시 시도해 주세요." }
                : m
            )
          );
          return;
        }

        const usedEngine = res.headers.get("X-Luna-Engine") ?? engine;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += decoder.decode(value, { stream: true });
          const snapshot = assistantContent;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantTempId
                ? { ...m, content: snapshot, engine: usedEngine }
                : m.id === userTempId
                  ? { ...m, engine: usedEngine }
                  : m
            )
          );
        }

        await loadConversations();
        await loadMessages(conversationId);
      } catch (err) {
        console.error("[luna] chat stream", err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? { ...m, content: m.content || "오류가 발생했습니다." }
              : m
          )
        );
      } finally {
        setSending(false);
      }
    },
    [selectedConversationId, engine, loadConversations, loadMessages]
  );

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      {/* PC 사이드바 */}
      <div className="hidden h-full md:flex">
        <LunaSidebar
          conversations={conversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          onNewChat={() => void onNewChat()}
        />
      </div>

      {/* 모바일: 목록 */}
      <div
        className={`h-full w-full md:hidden ${
          selectedConversationId ? "hidden" : "flex"
        }`}
      >
        <LunaSidebar
          conversations={conversations}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          onNewChat={() => void onNewChat()}
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
            engine={engine}
            onEngineChange={(e) => void onEngineChange(e)}
            onSend={(text) => void sendMessage(text)}
            onSuggestion={(text) => void sendMessage(text)}
            onBack={() => setSelectedConversationId(null)}
            sending={sending}
            showMobileHeader={Boolean(selectedConversationId)}
          />
        )}
      </div>
    </div>
  );
}
