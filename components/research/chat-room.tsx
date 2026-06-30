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
import { ArrowLeft, Upload } from "lucide-react";
import Link from "next/link";
import { useResearchRooms } from "@/components/research/research-rooms-context";
import { RoomChatMessage } from "@/components/research/chat-message";
import { SupplyToast } from "@/components/supplies/toast";
import { storagePublicUrl } from "@/lib/storage/public-url";
import {
  buildMessageMetadata,
  detectMessageType,
  type TrendMessage,
  type TrendRoom
} from "@/lib/research/types";
import { containsSnsLink } from "@/lib/research/sns-link";
import { getTrendRoomDisplayName } from "@/lib/research/week-label";
import {
  mapTrendMessageRow,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  TREND_MESSAGE_SELECT
} from "@/lib/research/trend-message-map";
import { isOwnTrendMessage } from "@/lib/research/message-ownership";
import { supabase } from "@/lib/supabase/client";
import { useResearchManager } from "@/lib/services/use-service-permissions";

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
const THINKING_MESSAGE_ID = "thinking";
const MESSAGES_PAGE_SIZE = MESSAGE_PAGE_DEFAULT_LIMIT;
const MESSAGE_SELECT = TREND_MESSAGE_SELECT;
const mapMessageRow = mapTrendMessageRow;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function detectUploadKind(file: File): "image" | "file" | null {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return "image";
  if (file.type === "application/pdf") return "file";
  return null;
}

function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

function getOldestPersistedMessage(messages: TrendMessage[]): TrendMessage | null {
  return messages.find((message) => message.id !== THINKING_MESSAGE_ID) ?? null;
}

async function fetchMessagesPage(
  roomId: string,
  token: string,
  before?: string
): Promise<{ messages: TrendMessage[]; has_more: boolean }> {
  const params = new URLSearchParams({
    room_id: roomId,
    limit: String(MESSAGES_PAGE_SIZE)
  });
  if (before) params.set("before", before);

  const response = await fetch(`/api/research/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = (await response.json()) as {
    messages?: TrendMessage[];
    has_more?: boolean;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? "메시지를 불러오지 못했습니다.");
  }

  return {
    messages: data.messages ?? [],
    has_more: data.has_more === true
  };
}

function getMessageSenderName(message: TrendMessage): string {
  if (message.message_type === "ai") return "루나 (Luna)";
  return message.profile?.name?.trim() || "알 수 없음";
}

function truncatePreview(content: string, max = 30): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function formatDateRange(start: string, end: string): string {
  const fmt = (value: string) => {
    const [year, month, day] = value.split("-");
    return `${year}.${month}.${day}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
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

type RoomSettingsMenuProps = {
  canDeleteRoom: boolean;
  canEditPrompt: boolean;
  onRename: () => void;
  onEditPrompt: () => void;
  onDelete: () => Promise<boolean>;
  deleteBusy?: boolean;
};

function RoomSettingsMenu({
  canDeleteRoom,
  canEditPrompt,
  onRename,
  onEditPrompt,
  onDelete,
  deleteBusy = false
}: RoomSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
    }
  }, [open]);

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

  const handleDeleteConfirm = async () => {
    const deleted = await onDelete();
    if (deleted) {
      setOpen(false);
      setConfirmingDelete(false);
    }
  };

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
          {confirmingDelete ? (
            <div className="px-3 py-2.5">
              <p className="text-sm text-[#0d0d0d]">정말 삭제할까요?</p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleteBusy}
                  className="rounded-md px-2.5 py-1 text-xs text-[#676767] hover:bg-[#f4f4f4] disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteConfirm()}
                  disabled={deleteBusy}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteBusy ? "삭제 중…" : "확인"}
                </button>
              </div>
            </div>
          ) : (
            <>
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
              {canEditPrompt ? (
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left text-sm text-[#0d0d0d] hover:bg-[#f4f4f4]"
                  onClick={() => {
                    setOpen(false);
                    onEditPrompt();
                  }}
                >
                  AI 프롬프트 수정
                </button>
              ) : null}
              {canDeleteRoom ? (
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={() => setConfirmingDelete(true)}
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
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

type RoomChatInputProps = {
  disabled?: boolean;
  uploading?: boolean;
  replyingTo?: TrendMessage | null;
  onCancelReply?: () => void;
  onSend: (content: string) => Promise<void>;
  onUploadFile: (file: File, kind: "image" | "file") => Promise<void>;
};

function RoomChatInput({
  disabled = false,
  uploading = false,
  replyingTo = null,
  onCancelReply,
  onSend,
  onUploadFile
}: RoomChatInputProps) {
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
        {replyingTo ? (
          <div
            className="mb-2 flex items-start justify-between gap-3 rounded-lg px-3 py-2"
            style={{
              background: "var(--color-background-secondary)",
              borderLeft: "2px solid #534AB7"
            }}
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0d0d0d]">{getMessageSenderName(replyingTo)}</p>
              <p className="mt-0.5 truncate text-xs text-[#676767]">{truncatePreview(replyingTo.content)}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="shrink-0 rounded p-1 text-[#8e8e8e] transition hover:bg-[#ebebeb] hover:text-[#0d0d0d]"
              aria-label="답장 취소"
            >
              ✕
            </button>
          </div>
        ) : null}
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
            placeholder={uploading ? "파일 업로드 중…" : "링크, 영상, 기사를 던져주세요. 루나가 분석할게요."}
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
    isSnsLink?: boolean;
  },
  callbacks?: {
    onStart?: () => void;
    onComplete?: () => void;
  }
) {
  if (payload.message_type === "ai" || payload.message_type === "sns_memo") return;

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
          metadata: payload.metadata,
          isSnsLink: payload.isSnsLink === true
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
  const { onRoomUpdated, removeRoom } = useResearchRooms() ?? {};
  const [room, setRoom] = useState<TrendRoom | null>(null);
  const [messages, setMessages] = useState<TrendMessage[]>([]);
  const [viewerId, setViewerId] = useState(profileId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canManageRoom = useResearchManager() === true;
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TrendMessage | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollRestoreHeightRef = useRef<number | null>(null);
  const messagesLoadKindRef = useRef<"initial" | "prepend" | "append" | null>("initial");
  const dragCounterRef = useRef(0);

  useEffect(() => {
    setViewerId(profileId);
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      const sessionUserId = data.session?.user?.id;
      if (!cancelled && sessionUserId) {
        setViewerId(sessionUserId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  const snsMemoAiMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      const forAiId = message.metadata?.for_ai_message_id;
      if (message.message_type === "sns_memo" && typeof forAiId === "string") {
        ids.add(forAiId);
      }
    }
    return ids;
  }, [messages]);

  const scrollToMessage = useCallback((messageId: string) => {
    document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

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
      messagesLoadKindRef.current = "append";
      return [...withoutThinking, message].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, []);

  const addThinkingMessage = useCallback(() => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === THINKING_MESSAGE_ID)) return prev;
      messagesLoadKindRef.current = "append";
      return [...prev, createThinkingMessage(roomId)];
    });
  }, [roomId]);

  const removeThinkingMessage = useCallback(() => {
    setMessages((prev) => prev.filter((item) => item.id !== THINKING_MESSAGE_ID));
  }, []);

  const handleDeleteMessage = useCallback(
    async (message: TrendMessage) => {
      const isOwn = isOwnTrendMessage(message, viewerId);
      if (!isOwn && !canManageRoom) return false;
      if (message.id === THINKING_MESSAGE_ID) return false;
      if (!window.confirm("이 메시지를 삭제할까요?")) return false;

      const { error: deleteError } = await supabase.from("trend_messages").delete().eq("id", message.id);
      if (deleteError) {
        setError(deleteError.message);
        return false;
      }

      setMessages((prev) => prev.filter((item) => item.id !== message.id));
      setError(null);
      return true;
    },
    [canManageRoom, viewerId]
  );

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return;

    const oldest = getOldestPersistedMessage(messages);
    if (!oldest) return;

    const scrollEl = messagesScrollRef.current;
    if (scrollEl) {
      scrollRestoreHeightRef.current = scrollEl.scrollHeight;
    }

    setLoadingOlder(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("로그인 세션이 없습니다.");
        return;
      }

      const { messages: olderMessages, has_more } = await fetchMessagesPage(roomId, token, oldest.id);
      messagesLoadKindRef.current = "prepend";
      setMessages((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const merged = [...olderMessages.filter((item) => !existingIds.has(item.id)), ...prev];
        return merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
      setHasMoreOlder(has_more);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "이전 대화를 불러오지 못했습니다.");
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMoreOlder, loadingOlder, messages, roomId]);

  const handleMessagesScroll = useCallback(() => {
    const scrollEl = messagesScrollRef.current;
    if (!scrollEl) return;

    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;

    if (scrollEl.scrollTop < 80 && hasMoreOlder && !loadingOlder) {
      void loadOlderMessages();
    }
  }, [hasMoreOlder, loadOlderMessages, loadingOlder]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setHasMoreOlder(false);
      messagesLoadKindRef.current = "initial";
      shouldStickToBottomRef.current = true;

      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        if (!cancelled) {
          setError("로그인 세션이 없습니다.");
          setLoading(false);
        }
        return;
      }

      try {
        const [roomResult, messagesResult] = await Promise.all([
          supabase.from("trend_rooms").select("*").eq("id", roomId).maybeSingle(),
          fetchMessagesPage(roomId, token)
        ]);

        if (cancelled) return;

        if (roomResult.error || !roomResult.data) {
          setError(roomResult.error?.message ?? "채팅방을 찾을 수 없습니다.");
          setLoading(false);
          return;
        }

        setRoom(roomResult.data as TrendRoom);
        setMessages(messagesResult.messages);
        setHasMoreOlder(messagesResult.has_more);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "채팅방을 불러오지 못했습니다.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (loading) return;

    const scrollEl = messagesScrollRef.current;
    const loadKind = messagesLoadKindRef.current;

    if (loadKind === "initial") {
      scrollToBottom("auto");
      messagesLoadKindRef.current = null;
      return;
    }

    if (loadKind === "prepend" && scrollEl && scrollRestoreHeightRef.current !== null) {
      scrollEl.scrollTop = scrollEl.scrollHeight - scrollRestoreHeightRef.current;
      scrollRestoreHeightRef.current = null;
      messagesLoadKindRef.current = null;
      return;
    }

    if (loadKind === "append" && shouldStickToBottomRef.current) {
      scrollToBottom();
      messagesLoadKindRef.current = null;
    }
  }, [loading, messages, scrollToBottom]);

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
    metadata: UploadMetadata | ReturnType<typeof buildMessageMetadata> | Record<string, unknown> | null;
  }) => {
    const { data, error: insertError } = await supabase
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: viewerId,
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
          metadata: message.metadata,
          isSnsLink: containsSnsLink(message.content)
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
    const baseMetadata = buildMessageMetadata(content, messageType);
    const metadata = replyingTo
      ? { ...(baseMetadata ?? {}), reply_to_id: replyingTo.id }
      : baseMetadata;

    await insertMessage({ content, message_type: messageType, metadata });
    setReplyingTo(null);
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

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (room?.is_archived || uploading || !dataTransferHasFiles(event.dataTransfer)) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (room?.is_archived || uploading || !dataTransferHasFiles(event.dataTransfer)) return;
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    if (room?.is_archived || uploading) return;

    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      const kind = detectUploadKind(file);
      if (kind) {
        await handleUploadFile(file, kind);
      }
    }
  };

  const openRenameModal = () => {
    setRenameValue(room ? getTrendRoomDisplayName(room) : "");
    setRenameOpen(true);
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !room) return;

    setRenameBusy(true);
    const { data, error: updateError } = await supabase
      .from("trend_rooms")
      .update({ week_label: trimmed, name: trimmed })
      .eq("id", room.id)
      .select("*")
      .single();

    setRenameBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (data) {
      const updatedRoom = data as TrendRoom;
      setRoom(updatedRoom);
      onRoomUpdated?.(updatedRoom);
      setRenameOpen(false);
      setError(null);
    }
  };

  const handleDelete = async (): Promise<boolean> => {
    if (!room || deleteBusy) return false;

    setDeleteBusy(true);
    const deletedRoomId = room.id;
    const { error: deleteError } = await supabase.from("trend_rooms").delete().eq("id", deletedRoomId);
    setDeleteBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return false;
    }

    removeRoom?.(deletedRoomId);
    router.push("/research");
    return true;
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-[rgba(0,0,0,0.08)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            href="/research"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#0d0d0d] transition hover:bg-[#f4f4f4] md:hidden"
            aria-label="채팅방 목록으로"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-[#0d0d0d]">
              {room ? getTrendRoomDisplayName(room) : "트렌드 공유"}
            </h1>
            {room ? (
              <p className="mt-0.5 text-xs text-[#8e8e8e]">{formatDateRange(room.week_start, room.week_end)}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RoomSettingsMenu
            canDeleteRoom={canManageRoom}
            canEditPrompt={canManageRoom}
            onRename={openRenameModal}
            onEditPrompt={() => router.push("/research/publishing/prompts")}
            onDelete={handleDelete}
            deleteBusy={deleteBusy}
          />
        </div>
      </header>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event)}
      >
        {isDragOver ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
            style={{
              background: "rgba(83, 74, 183, 0.15)",
              border: "2px dashed #534AB7"
            }}
          >
            <Upload className="h-12 w-12 text-[#534AB7]" aria-hidden />
            <p className="mt-3 text-base font-medium text-[#534AB7]">파일을 여기에 놓으세요</p>
          </div>
        ) : null}

        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain md:overscroll-auto"
        >
        {!loading && messages.length > 0 ? (
          <div className="sticky top-0 z-[1] bg-white/95 px-4 py-3 backdrop-blur-sm">
            {loadingOlder ? (
              <div className="flex items-center justify-center gap-2 text-xs text-[#8e8e8e]">
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-[#534AB7]/30 border-t-[#534AB7]"
                  aria-hidden
                />
                이전 대화 불러오는 중…
              </div>
            ) : hasMoreOlder ? (
              <button
                type="button"
                onClick={() => void loadOlderMessages()}
                className="mx-auto block text-xs font-medium text-[#534AB7] transition hover:text-[#3f378f]"
              >
                이전 대화 불러오기
              </button>
            ) : (
              <p className="text-center text-xs text-[#8e8e8e]">처음 대화입니다</p>
            )}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex min-h-[12rem] items-center justify-center px-6">
            <p className="text-center text-sm text-[#8e8e8e]">아직 메시지가 없습니다. 첫 트렌드를 공유해 보세요.</p>
          </div>
        ) : (
          <div className="mx-auto min-w-0 w-full max-w-3xl">
            {messages.map((message) => {
              const replyId = message.reply_to_id ?? message.metadata?.reply_to_id;
              const replyToMessage = replyId ? messageById.get(replyId) ?? null : null;

              return (
                <RoomChatMessage
                  key={message.id}
                  message={message}
                  roomId={roomId}
                  currentUserId={viewerId}
                  snsMemoSaved={
                    message.metadata?.sns_memo_saved === true || snsMemoAiMessageIds.has(message.id)
                  }
                  canDelete={
                    message.id !== THINKING_MESSAGE_ID &&
                    (isOwnTrendMessage(message, viewerId) || canManageRoom)
                  }
                  onDelete={handleDeleteMessage}
                  onReply={setReplyingTo}
                  replyToMessage={replyToMessage}
                  onScrollToMessage={scrollToMessage}
                />
              );
            })}
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
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
      </div>

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

      <SupplyToast message={toast} onClose={() => setToast(null)} />

    </div>
  );
}
