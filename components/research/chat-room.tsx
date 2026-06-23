"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ChatMessage } from "@/components/research/chat-message";
import { collectParticipants, getInitials, getProfileAvatarColors } from "@/lib/research/avatar";
import { storagePublicUrl } from "@/lib/storage/public-url";
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

type UploadMetadata = {
  url?: string;
  filename?: string;
  filesize?: number;
  mimetype?: string;
};

const UPLOAD_BUCKET = "trend-uploads";
const SUPER_ADMIN_ROLE = "슈퍼관리자";
const THINKING_MESSAGE_ID = "thinking";

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

function formatDateRange(start: string, end: string): string {
  const fmt = (value: string) => {
    const [year, month, day] = value.split("-");
    return `${year}.${month}.${day}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function IconSettings(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconSend(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6l-.9 7.8 9.6 1.2-9.6 1.2.9 7.8Z" />
    </svg>
  );
}

function IconPlus(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ParticipantAvatars({ messages }: { messages: TrendMessage[] }) {
  const participants = useMemo(() => collectParticipants(messages), [messages]);
  const visible = participants.slice(0, 5);
  const overflow = participants.length - visible.length;

  if (participants.length === 0) {
    return <span className="text-xs text-[#8e8e8e]">참여자 없음</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {visible.map((participant) => {
          const colors = getProfileAvatarColors(participant.id);
          return (
            <div
              key={participant.id}
              title={participant.name}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {getInitials(participant.name)}
            </div>
          );
        })}
      </div>
      <span className="text-xs text-[#676767]">
        {participants.length}명{overflow > 0 ? ` (+${overflow})` : ""}
      </span>
    </div>
  );
}

function UploadMessageBody({ message }: { message: TrendMessage }) {
  const meta = (message.metadata ?? {}) as UploadMetadata;
  const url = meta.url ?? message.content;
  const filename = meta.filename ?? message.content;
  const filesize = meta.filesize ?? 0;

  if (message.message_type === "image" && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
        <img
          src={url}
          alt={filename}
          className="max-h-72 max-w-full rounded-xl object-cover"
          style={{ border: "0.5px solid var(--color-border)" }}
          loading="lazy"
        />
      </a>
    );
  }

  if ((message.message_type as string) === "file" && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex max-w-sm items-center gap-3 rounded-xl px-3.5 py-3 transition hover:opacity-90"
        style={{
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border)"
        }}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-xs font-bold text-red-600">
          PDF
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#0d0d0d]">{filename}</p>
          {filesize > 0 ? <p className="mt-0.5 text-xs text-[#8e8e8e]">{formatFileSize(filesize)}</p> : null}
        </div>
      </a>
    );
  }

  return null;
}

function RoomChatMessage({ message, currentUserId }: { message: TrendMessage; currentUserId: string }) {
  const isUpload =
    message.message_type === "image" || (message.message_type as string) === "file";

  if (!isUpload) {
    return <ChatMessage message={message} currentUserId={currentUserId} />;
  }

  const senderName = message.profile?.name?.trim() || "알 수 없음";
  const avatarColors = getProfileAvatarColors(message.profile_id);

  return (
    <div className="group flex gap-3 px-4 py-4 sm:px-6 hover:bg-[#fafafa]">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ backgroundColor: avatarColors.bg, color: avatarColors.text }}
        aria-hidden
      >
        {getInitials(senderName)}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-[#0d0d0d]">{senderName}</span>
          <time className="text-xs text-[#8e8e8e]" dateTime={message.created_at}>
            {formatMessageTime(message.created_at)}
          </time>
        </div>
        <UploadMessageBody message={message} />
      </div>
    </div>
  );
}

type RoomSettingsMenuProps = {
  isSuperAdmin: boolean;
  onRename: () => void;
  onDelete: () => void;
};

function RoomSettingsMenu({ isSuperAdmin, onRename, onDelete }: RoomSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676767] transition hover:bg-[#f4f4f4] hover:text-[#0d0d0d]"
        aria-label="채팅방 설정"
        aria-expanded={open}
      >
        <IconSettings className="h-5 w-5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[168px] overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-white py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-left text-sm text-[#0d0d0d] hover:bg-[#f4f4f4]"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            채팅방 이름 변경
          </button>
          {isSuperAdmin ? (
            <button
              type="button"
              className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              채팅방 삭제
            </button>
          ) : null}
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-left text-sm text-[#676767] hover:bg-[#f4f4f4]"
            onClick={() => setOpen(false)}
          >
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}

type RoomChatInputProps = {
  disabled?: boolean;
  uploading?: boolean;
  onSend: (content: string) => Promise<void>;
  onUploadFile: (file: File, kind: "image" | "file") => Promise<void>;
};

function RoomChatInput({ disabled = false, uploading = false, onSend, onUploadFile }: RoomChatInputProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!attachOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(event.target as Node)) {
        setAttachOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachOpen]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled || uploading) return;

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

  const handleFileChange = async (file: File | undefined, kind: "image" | "file") => {
    if (!file || disabled || uploading) return;
    setAttachOpen(false);
    await onUploadFile(file, kind);
  };

  const inputDisabled = disabled || sending || uploading;

  return (
    <div className="shrink-0 bg-white px-4 pb-4 pt-2 sm:px-6">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div
          className="flex items-end gap-2 rounded-[26px] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
          style={{ background: "var(--color-background-secondary, #f4f4f4)" }}
        >
          <div ref={attachRef} className="relative shrink-0">
            <button
              type="button"
              disabled={inputDisabled}
              onClick={() => setAttachOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#676767] transition hover:bg-[#e5e5e5] hover:text-[#0d0d0d] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="파일 첨부"
              aria-expanded={attachOpen}
            >
              <IconPlus className="h-5 w-5" />
            </button>

            {attachOpen ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-[rgba(0,0,0,0.08)] bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left text-sm text-[#0d0d0d] hover:bg-[#f4f4f4]"
                  onClick={() => imageInputRef.current?.click()}
                >
                  이미지 업로드
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left text-sm text-[#0d0d0d] hover:bg-[#f4f4f4]"
                  onClick={() => pdfInputRef.current?.click()}
                >
                  PDF 업로드
                </button>
              </div>
            ) : null}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              className="hidden"
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0], "image");
                event.target.value = "";
              }}
            />
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0], "file");
                event.target.value = "";
              }}
            />
          </div>

          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={uploading ? "파일 업로드 중…" : "메시지를 입력하세요…"}
            rows={1}
            disabled={inputDisabled}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-[#0d0d0d] placeholder:text-[#8e8e8e] focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={inputDisabled || !value.trim()}
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

function createThinkingMessage(roomId: string): TrendMessage {
  return {
    id: THINKING_MESSAGE_ID,
    room_id: roomId,
    profile_id: null,
    content: "생각 중...",
    message_type: "ai",
    metadata: { isThinking: true } as TrendMessage["metadata"],
    created_at: new Date().toISOString()
  };
}

function requestLunaAnalysis(
  payload: {
    room_id: string;
    message_id: string;
    content: string;
    message_type: string;
    metadata: UploadMetadata | ReturnType<typeof buildMessageMetadata> | null;
  },
  callbacks?: {
    onStart?: () => void;
    onComplete?: () => void;
  }
) {
  if (payload.message_type === "ai") return;

  callbacks?.onStart?.();

  void (async () => {
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        console.error("[research/chat-room] Luna API skipped: no access token");
        return;
      }

      const response = await fetch("/api/research/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          room_id: payload.room_id,
          message_id: payload.message_id,
          content: payload.content,
          message_type: payload.message_type,
          metadata: payload.metadata
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        console.error("[research/chat-room] Luna API failed", response.status, detail);
      }
    } catch (error) {
      console.error("[research/chat-room] Luna API error", error);
    } finally {
      callbacks?.onComplete?.();
    }
  })();
}

export function ChatRoom({ roomId, profileId }: ChatRoomProps) {
  const router = useRouter();
  const [room, setRoom] = useState<TrendRoom | null>(null);
  const [messages, setMessages] = useState<TrendMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = userRole === SUPER_ADMIN_ROLE;

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
      const withoutThinking =
        message.message_type === "ai" ? prev.filter((item) => item.id !== THINKING_MESSAGE_ID) : prev;
      if (withoutThinking.some((item) => item.id === message.id)) return withoutThinking;
      return [...withoutThinking, message].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, []);

  const addThinkingMessage = useCallback(() => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === THINKING_MESSAGE_ID)) return prev;
      return [...prev, createThinkingMessage(roomId)];
    });
  }, [roomId]);

  const removeThinkingMessage = useCallback(() => {
    setMessages((prev) => prev.filter((item) => item.id !== THINKING_MESSAGE_ID));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.from("profiles").select("role").eq("id", profileId).maybeSingle();
      if (!cancelled && data?.role) {
        setUserRole(String(data.role));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId]);

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

      setRoom(roomResult.data as TrendRoom);
      setMessages(rows);
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
          })();
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("[research/chat-room] Realtime subscription failed");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, fetchMessageById, upsertMessage]);

  const insertMessage = async (payload: {
    content: string;
    message_type: string;
    metadata: UploadMetadata | ReturnType<typeof buildMessageMetadata>;
  }) => {
    const { data, error: insertError } = await supabase
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: profileId,
        content: payload.content,
        message_type: payload.message_type,
        metadata: payload.metadata
      })
      .select(MESSAGE_SELECT)
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (data) {
      const message = mapMessageRow(data as Record<string, unknown>);
      upsertMessage(message);
      setError(null);
      requestLunaAnalysis(
        {
          room_id: roomId,
          message_id: message.id,
          content: message.content,
          message_type: message.message_type,
          metadata: message.metadata
        },
        {
          onStart: addThinkingMessage,
          onComplete: removeThinkingMessage
        }
      );
    }
  };

  const handleSend = async (content: string) => {
    const messageType = detectMessageType(content);
    const metadata = buildMessageMetadata(content, messageType);
    await insertMessage({ content, message_type: messageType, metadata });
  };

  const handleUploadFile = async (file: File, kind: "image" | "file") => {
    if (kind === "image") {
      const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowed.includes(file.type)) {
        setError("jpg, png, gif, webp 이미지만 업로드할 수 있습니다.");
        return;
      }
    } else if (file.type !== "application/pdf") {
      setError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || (kind === "image" ? "jpg" : "pdf");
      const path = `${roomId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type
      });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const url = storagePublicUrl(UPLOAD_BUCKET, path);
      const metadata: UploadMetadata = {
        url,
        filename: file.name,
        filesize: file.size,
        mimetype: file.type
      };

      await insertMessage({
        content: file.name,
        message_type: kind,
        metadata
      });
    } finally {
      setUploading(false);
    }
  };

  const openRenameModal = () => {
    setRenameValue(room?.week_label ?? "");
    setRenameOpen(true);
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !room) return;

    setRenameBusy(true);
    const { data, error: updateError } = await supabase
      .from("trend_rooms")
      .update({ week_label: trimmed })
      .eq("id", room.id)
      .select("*")
      .single();

    setRenameBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (data) {
      setRoom(data as TrendRoom);
      setRenameOpen(false);
      setError(null);
    }
  };

  const handleDelete = async () => {
    if (!room) return;

    setDeleteBusy(true);
    const { error: deleteError } = await supabase.from("trend_rooms").delete().eq("id", room.id);
    setDeleteBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      setDeleteOpen(false);
      return;
    }

    router.push("/research");
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[#8e8e8e]">채팅방을 불러오는 중…</div>
    );
  }

  if (error && !room) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] px-4 py-4 sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-[#0d0d0d]">{room?.week_label ?? "트렌드 공유"}</h1>
          {room ? (
            <p className="mt-0.5 text-xs text-[#8e8e8e]">{formatDateRange(room.week_start, room.week_end)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ParticipantAvatars messages={messages} />
          <RoomSettingsMenu
            isSuperAdmin={isSuperAdmin}
            onRename={openRenameModal}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <p className="text-center text-sm text-[#8e8e8e]">아직 메시지가 없습니다. 첫 트렌드를 공유해 보세요.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {messages.map((message) => (
              <RoomChatMessage key={message.id} message={message} currentUserId={profileId} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <p className="shrink-0 border-t border-red-100 bg-red-50 px-4 py-2 text-center text-xs text-red-600">{error}</p>
      ) : null}

      <RoomChatInput
        onSend={handleSend}
        onUploadFile={handleUploadFile}
        disabled={room?.is_archived}
        uploading={uploading}
      />

      {renameOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[#0d0d0d]">채팅방 이름 변경</h2>
            <input
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="mt-4 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2.5 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
              placeholder="채팅방 이름"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                disabled={renameBusy}
                className="rounded-lg px-4 py-2 text-sm text-[#676767] hover:bg-[#f4f4f4]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={renameBusy || !renameValue.trim()}
                className="rounded-lg bg-[#0d0d0d] px-4 py-2 text-sm font-medium text-white hover:bg-[#333] disabled:opacity-50"
              >
                {renameBusy ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[#0d0d0d]">채팅방 삭제</h2>
            <p className="mt-2 text-sm text-[#676767]">
              &quot;{room?.week_label}&quot; 채팅방을 삭제할까요? 메시지도 함께 삭제되며 되돌릴 수 없습니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteBusy}
                className="rounded-lg px-4 py-2 text-sm text-[#676767] hover:bg-[#f4f4f4]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
