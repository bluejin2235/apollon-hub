"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/research/chat-input";
import { ChatMessage } from "@/components/research/chat-message";
import {
  buildMessageMetadata,
  detectMessageType,
  type TrendMessage,
  type TrendRoom
} from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

type ChatRoomProps = {
  roomId: string;
  profileId: string;
};

const MESSAGE_SELECT = `
  id,
  room_id,
  profile_id,
  content,
  message_type,
  metadata,
  created_at,
  profile:profiles!profile_id (
    id,
    name
  )
`;

function mapMessageRow(row: Record<string, unknown>): TrendMessage {
  const profileRaw = row.profile;
  const profile =
    profileRaw && typeof profileRaw === "object" && !Array.isArray(profileRaw)
      ? {
          id: String((profileRaw as { id: unknown }).id),
          name: String((profileRaw as { name: unknown }).name ?? "")
        }
      : null;

  return {
    id: String(row.id),
    room_id: String(row.room_id),
    profile_id: row.profile_id ? String(row.profile_id) : null,
    content: String(row.content ?? ""),
    message_type: row.message_type as TrendMessage["message_type"],
    metadata: (row.metadata as TrendMessage["metadata"]) ?? null,
    created_at: String(row.created_at),
    profile
  };
}

export function ChatRoom({ roomId, profileId }: ChatRoomProps) {
  const [room, setRoom] = useState<TrendRoom | null>(null);
  const [messages, setMessages] = useState<TrendMessage[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const fetchMessageById = useCallback(async (messageId: string) => {
    const { data, error: fetchError } = await supabase
      .from("trend_messages")
      .select(MESSAGE_SELECT)
      .eq("id", messageId)
      .maybeSingle();

    if (fetchError || !data) return null;
    return mapMessageRow(data as Record<string, unknown>);
  }, []);

  const upsertMessage = useCallback((message: TrendMessage) => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === message.id)) return prev;
      return [...prev, message].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      const [roomResult, messagesResult] = await Promise.all([
        supabase.from("trend_rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase.from("trend_messages").select(MESSAGE_SELECT).eq("room_id", roomId).order("created_at", {
          ascending: true
        })
      ]);

      if (cancelled) return;

      if (roomResult.error || !roomResult.data) {
        setError(roomResult.error?.message ?? "채팅방을 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      if (messagesResult.error) {
        setError(messagesResult.error.message);
        setLoading(false);
        return;
      }

      const rows = (messagesResult.data ?? []).map((row) => mapMessageRow(row as Record<string, unknown>));
      const participants = new Set(
        rows.map((message) => message.profile_id).filter((id): id is string => Boolean(id))
      );

      setRoom(roomResult.data as TrendRoom);
      setMessages(rows);
      setParticipantCount(participants.size);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!loading) {
      scrollToBottom("auto");
    }
  }, [loading, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const channel = supabase
      .channel(`trend_messages:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trend_messages",
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          void (async () => {
            const insertedId = String((payload.new as { id: unknown }).id);
            const message = await fetchMessageById(insertedId);
            if (!message) return;

            upsertMessage(message);
            if (message.profile_id) {
              setParticipantCount((prev) => {
                const ids = new Set(messages.map((item) => item.profile_id).filter(Boolean));
                ids.add(message.profile_id);
                return ids.size;
              });
            }
          })();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, fetchMessageById, upsertMessage, messages]);

  const handleSend = async (content: string) => {
    const messageType = detectMessageType(content);
    const metadata = buildMessageMetadata(content, messageType);

    const { data, error: insertError } = await supabase
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: profileId,
        content,
        message_type: messageType,
        metadata
      })
      .select(MESSAGE_SELECT)
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (data) {
      upsertMessage(mapMessageRow(data as Record<string, unknown>));
      setParticipantCount((prev) => Math.max(prev, 1));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">채팅방을 불러오는 중…</div>
    );
  }

  if (error && !room) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{room?.week_label ?? "트렌드 공유"}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {room?.week_start} ~ {room?.week_end}
          </p>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          참여자 {participantCount}명
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-3">
        {messages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">아직 메시지가 없습니다. 첫 트렌드를 공유해 보세요.</p>
        ) : (
          messages.map((message) => <ChatMessage key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="shrink-0 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">{error}</p> : null}

      <div className="shrink-0">
        <ChatInput onSend={handleSend} disabled={room?.is_archived} />
      </div>
    </div>
  );
}
