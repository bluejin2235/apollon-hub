"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { getInitials, getProfileAvatarColors } from "@/lib/research/avatar";
import type { TrendMessage } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

type MessageMetadata = TrendMessage["metadata"] & {
  is_pinned?: boolean;
  is_pinned_notification?: boolean;
  has_analysis?: boolean;
  ai_model?: string;
  isThinking?: boolean;
  reply_to_id?: string;
  is_sns_guidance?: boolean;
  sns_url?: string;
  sns_memo_saved?: boolean;
};

type ChatMessageProps = {
  message: TrendMessage;
  roomId?: string;
  currentUserId?: string;
  snsMemoSaved?: boolean;
  isThinking?: boolean;
  canDelete?: boolean;
  onDelete?: (message: TrendMessage) => Promise<boolean>;
  onReply?: (message: TrendMessage) => void;
  replyToMessage?: TrendMessage | null;
  onScrollToMessage?: (messageId: string) => void;
};

type UploadMetadata = {
  url?: string;
  filename?: string;
  filesize?: number;
  imageUrl?: string;
};

function formatBubbleTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LinkPreviewCard({ message, className = "" }: { message: TrendMessage; className?: string }) {
  const url = message.metadata?.url ?? message.content;
  const title = message.metadata?.title ?? url;
  const description = message.metadata?.description;
  const domain = message.metadata?.domain ?? url;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block overflow-hidden rounded-xl transition hover:opacity-90 ${className}`}
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border)"
      }}
    >
      <div className="px-3.5 py-3">
        <p className="line-clamp-2 text-sm font-medium text-[#0d0d0d]">{title}</p>
        {description ? <p className="mt-1 line-clamp-2 text-xs text-[#676767]">{description}</p> : null}
        <p className="mt-2 text-[11px] text-[#8e8e8e]">{domain}</p>
      </div>
    </a>
  );
}

function YoutubePreviewCard({ message, className = "" }: { message: TrendMessage; className?: string }) {
  const url = message.metadata?.url ?? message.content;
  const thumbnailUrl = message.metadata?.thumbnailUrl;
  const title = message.metadata?.title ?? "YouTube";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block overflow-hidden rounded-xl transition hover:opacity-90 ${className}`}
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border)"
      }}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
      ) : null}
      <div className="flex items-center gap-2 px-3.5 py-3">
        <span className="text-[#ff0000]" aria-hidden>
          ▶
        </span>
        <p className="line-clamp-2 text-sm font-medium text-[#0d0d0d]">{title}</p>
      </div>
    </a>
  );
}

function FilePreviewCard({ message, className = "" }: { message: TrendMessage; className?: string }) {
  const meta = (message.metadata ?? {}) as UploadMetadata;
  const url = meta.url ?? message.content;
  const filename = meta.filename ?? message.content;
  const filesize = meta.filesize ?? 0;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex max-w-full items-center gap-3 rounded-xl px-3.5 py-3 transition hover:opacity-90 ${className}`}
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

function getMessageSenderName(message: TrendMessage): string {
  if (message.message_type === "ai") return "루나 (Luna)";
  return message.profile?.name?.trim() || "알 수 없음";
}

function truncatePreview(content: string, max = 30): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function getReplyToId(message: TrendMessage): string | null {
  const meta = message.metadata as MessageMetadata | null;
  return message.reply_to_id ?? meta?.reply_to_id ?? null;
}

function shouldShowWeeklyPinButton(message: TrendMessage): boolean {
  const meta = message.metadata as MessageMetadata | null;
  if (message.message_type !== "ai") return false;
  if (meta?.is_pinned_notification === true) return false;
  if (meta?.has_analysis !== true) return false;
  return true;
}

function TablerCornerUpLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 14l-4 -4l4 -4" />
      <path d="M5 10h11a4 4 0 0 1 0 8h-1" />
    </svg>
  );
}

function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 shrink-0 rounded p-1 text-[#8e8e8e] opacity-0 transition hover:bg-[#f4f4f4] hover:text-[#534AB7] group-hover:opacity-100"
      aria-label="답장"
    >
      <TablerCornerUpLeftIcon />
    </button>
  );
}

function DeleteButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mb-1 shrink-0 rounded p-1 text-[#8e8e8e] opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
      aria-label="삭제"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
      </svg>
    </button>
  );
}

function ReplyPreview({
  replyToMessage,
  onClick
}: {
  replyToMessage: TrendMessage;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1.5 w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition hover:opacity-90"
      style={{
        background: "var(--color-background-secondary)",
        borderLeft: "2px solid var(--color-border-secondary, rgba(0, 0, 0, 0.15))"
      }}
    >
      <p className="text-[11px] font-semibold text-[#0d0d0d]">{getMessageSenderName(replyToMessage)}</p>
      <p className="mt-0.5 text-[11px] text-[#676767]">{truncatePreview(replyToMessage.content)}</p>
    </button>
  );
}

function formatAiModelLabel(model: string): string | null {
  switch (model) {
    case "claude-sonnet-4-6":
      return "Claude Sonnet 4.6";
    case "youtube-transcript + claude-sonnet-4-6":
      return "youtube-transcript + Claude Sonnet 4.6";
    case "vimeo + claude-sonnet-4-6":
      return "Vimeo transcript + Claude Sonnet 4.6";
    case "gemini-2.5-flash":
      return "Gemini 2.5 Flash";
    case "gpt-4o":
      return "GPT-4o";
    default:
      return null;
  }
}

function AiModelSource({ message }: { message: TrendMessage }) {
  const aiModel = (message.metadata as MessageMetadata | null)?.ai_model;
  const label = aiModel ? formatAiModelLabel(aiModel) : null;
  if (!label) return null;

  return (
    <span className="text-[10px]" style={{ color: "var(--color-text-tertiary, #8e8e8e)" }}>
      {label}
    </span>
  );
}

function TablerBookmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function WeeklyPinButton({
  isPinned,
  disabled,
  onClick
}: {
  isPinned: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 transition hover:opacity-90 disabled:opacity-50"
      style={{
        fontSize: "12px",
        padding: "3px 10px",
        borderRadius: "999px",
        border: isPinned ? "0.5px solid #534AB7" : "0.5px solid #AFA9EC",
        background: isPinned ? "#EEEDFE" : "transparent",
        color: isPinned ? "#3C3489" : "#534AB7"
      }}
    >
      <TablerBookmarkIcon />
      {isPinned ? "후보 등록됨" : "위클리 후보"}
    </button>
  );
}

function AiMessageFooter({
  message,
  isPinned,
  pinning,
  showPinButton,
  currentUserId,
  onPinToggle
}: {
  message: TrendMessage;
  isPinned: boolean;
  pinning: boolean;
  showPinButton: boolean;
  currentUserId?: string;
  onPinToggle: () => void;
}) {
  const aiModel = (message.metadata as MessageMetadata | null)?.ai_model;
  const label = aiModel ? formatAiModelLabel(aiModel) : null;

  if (!label && !(showPinButton && currentUserId)) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {label ? <AiModelSource message={message} /> : null}
      {showPinButton && currentUserId ? (
        <WeeklyPinButton isPinned={isPinned} disabled={pinning} onClick={onPinToggle} />
      ) : null}
    </div>
  );
}

function AvatarCircle({
  initials,
  bg,
  text
}: {
  initials: string;
  bg: string;
  text: string;
}) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ backgroundColor: bg, color: text }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function ThinkingDotsText() {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return <span className="break-all">{"생각 중" + ".".repeat(dots)}</span>;
}

function renderLunaMarkdownLine(line: string, lineKey: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|(`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      nodes.push(line.slice(last, match.index));
    }

    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${lineKey}-${tokenIndex++}`} className="font-semibold">
          {match[1]}
        </strong>
      );
    } else if (match[2]) {
      nodes.push(
        <span
          key={`${lineKey}-${tokenIndex++}`}
          className="mx-0.5 inline-block rounded-md bg-[#534AB7]/10 px-1.5 py-0.5 text-[13px] font-medium text-[#534AB7]"
        >
          {match[2].slice(1, -1)}
        </span>
      );
    }

    last = match.index + match[0].length;
  }

  if (last < line.length) {
    nodes.push(line.slice(last));
  }

  return nodes;
}

function LunaMarkdownText({ content, className }: { content: string; className: string }) {
  const lines = content.split("\n");

  return (
    <p className={className}>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {renderLunaMarkdownLine(line, lineIndex)}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </p>
  );
}

const SNS_MEMO_SELECT = `
  id,
  room_id,
  profile_id,
  content,
  message_type,
  metadata,
  created_at,
  profile:profiles!profile_id (id, name)
`;

function SnsMemoInput({
  lunaMessage,
  roomId,
  currentUserId,
  snsUrl
}: {
  lunaMessage: TrendMessage;
  roomId: string;
  currentUserId: string;
  snsUrl: string;
}) {
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (saved) return null;

  const handleSave = async () => {
    const trimmed = memo.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: currentUserId,
        content: trimmed,
        message_type: "sns_memo",
        metadata: { url: snsUrl, for_ai_message_id: lunaMessage.id }
      })
      .select(SNS_MEMO_SELECT)
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "메모 저장에 실패했습니다.");
      setSaving(false);
      return;
    }

    const existingMeta = (lunaMessage.metadata ?? {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from("trend_messages")
      .update({
        metadata: {
          ...existingMeta,
          sns_memo_saved: true,
          sns_memo_message_id: data.id
        }
      })
      .eq("id", lunaMessage.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSaved(true);
    setSaving(false);
  };

  return (
    <div className="mt-2 rounded-xl border border-[rgba(83,74,183,0.2)] bg-[#FAFAFF] px-3 py-2.5">
      <textarea
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
        placeholder="이 링크에 대해 간단히 메모해주세요 (2줄 이내)"
        maxLength={200}
        rows={2}
        disabled={saving}
        className="w-full resize-none rounded-lg border border-[rgba(0,0,0,0.1)] bg-white px-2.5 py-2 text-sm text-[#0d0d0d] placeholder:text-[#8e8e8e] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
      />
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !memo.trim()}
          className="rounded-lg bg-[#534AB7] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
        >
          {saving ? "저장 중…" : "메모 저장"}
        </button>
      </div>
    </div>
  );
}

function BubbleContent({
  message,
  isMine,
  isThinking = false
}: {
  message: TrendMessage;
  isMine: boolean;
  isThinking?: boolean;
}) {
  const textClass = isMine ? "text-[#1a1a1a]" : "text-[#0d0d0d]";
  const meta = (message.metadata ?? {}) as UploadMetadata;
  const imageUrl = meta.imageUrl ?? meta.url;

  if (message.message_type === "link") {
    const hasText = message.content.trim() !== (message.metadata?.url ?? "");
    return (
      <>
        {hasText ? (
          <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${textClass}`}>{message.content}</p>
        ) : null}
        <LinkPreviewCard message={message} className={hasText ? "mt-1.5" : ""} />
      </>
    );
  }

  if (message.message_type === "youtube") {
    const hasText = message.content.trim() !== (message.metadata?.url ?? "");
    return (
      <>
        {hasText ? (
          <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${textClass}`}>{message.content}</p>
        ) : null}
        <YoutubePreviewCard message={message} className={hasText ? "mt-1.5" : ""} />
      </>
    );
  }

  if (message.message_type === "image" && imageUrl) {
    return (
      <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
        <img
          src={imageUrl}
          alt=""
          className="max-h-72 max-w-full rounded-xl object-cover"
          style={{ border: "0.5px solid var(--color-border)" }}
          loading="lazy"
        />
      </a>
    );
  }

  if ((message.message_type as string) === "file") {
    return <FilePreviewCard message={message} />;
  }

  if (isThinking) {
    const thinkingClass = isMine ? "text-[#1a1a1a]" : "text-[#0d0d0d]";
    return (
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${thinkingClass}`}>
        <ThinkingDotsText />
      </p>
    );
  }

  const textBodyClass = `break-words text-[15px] leading-relaxed ${textClass}`;

  if (message.message_type === "ai") {
    return <LunaMarkdownText content={message.content} className={textBodyClass} />;
  }

  return (
    <p className={`whitespace-pre-wrap ${textBodyClass}`}>{message.content}</p>
  );
}

export function RoomChatMessage({
  message,
  roomId,
  currentUserId,
  snsMemoSaved = false,
  canDelete,
  onDelete,
  onReply,
  replyToMessage,
  onScrollToMessage
}: {
  message: TrendMessage;
  roomId: string;
  currentUserId: string;
  snsMemoSaved?: boolean;
  canDelete?: boolean;
  onDelete?: (message: TrendMessage) => Promise<boolean>;
  onReply?: (message: TrendMessage) => void;
  replyToMessage?: TrendMessage | null;
  onScrollToMessage?: (messageId: string) => void;
}) {
  return (
    <ChatMessage
      message={message}
      roomId={roomId}
      currentUserId={currentUserId}
      snsMemoSaved={snsMemoSaved}
      canDelete={canDelete}
      onDelete={onDelete}
      onReply={onReply}
      replyToMessage={replyToMessage}
      onScrollToMessage={onScrollToMessage}
    />
  );
}

export function ChatMessage({
  message,
  roomId,
  currentUserId,
  snsMemoSaved = false,
  isThinking,
  canDelete = false,
  onDelete,
  onReply,
  replyToMessage,
  onScrollToMessage
}: ChatMessageProps) {
  const isAi = message.message_type === "ai";
  const meta = message.metadata as MessageMetadata | null;
  const isThinkingMessage = isThinking ?? meta?.isThinking === true;
  const [isPinned, setIsPinned] = useState(
    (message.metadata as MessageMetadata | null)?.is_pinned === true
  );
  const [pinning, setPinning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setIsPinned((message.metadata as MessageMetadata | null)?.is_pinned === true);
  }, [message.id, message.metadata]);

  const handlePinToggle = async () => {
    if (!currentUserId || pinning || isThinkingMessage) return;

    const previous = isPinned;
    setIsPinned(!previous);
    setPinning(true);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setIsPinned(previous);
        return;
      }

      const response = await fetch("/api/research/pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          message_id: message.id,
          room_id: message.room_id
        })
      });

      if (!response.ok) {
        setIsPinned(previous);
        return;
      }

      const data = (await response.json()) as { pinned?: boolean };
      if (typeof data.pinned === "boolean") {
        setIsPinned(data.pinned);
      }
    } catch {
      setIsPinned(previous);
    } finally {
      setPinning(false);
    }
  };

  const isMine = Boolean(currentUserId && message.profile_id === currentUserId && !isAi);
  const senderName = getMessageSenderName(message);
  const initials = isAi ? "L" : getInitials(senderName);
  const avatarColors = isAi
    ? { bg: "#534AB7", text: "#FFFFFF" }
    : getProfileAvatarColors(message.profile_id);
  const timeLabel = formatBubbleTime(message.created_at);
  const showPinButton = shouldShowWeeklyPinButton(message);
  const resolvedReplyTo = replyToMessage ?? null;
  const showSnsMemoInput =
    isAi &&
    !isThinkingMessage &&
    !snsMemoSaved &&
    meta?.is_sns_guidance === true &&
    Boolean(meta.sns_url) &&
    Boolean(roomId && currentUserId);

  const handleReplyClick = () => {
    onReply?.(message);
  };

  const handleDeleteClick = () => {
    if (!onDelete || deleting || isThinkingMessage) return;
    setDeleting(true);
    void onDelete(message).finally(() => setDeleting(false));
  };

  const handleReplyPreviewClick = () => {
    const replyId = getReplyToId(message);
    if (replyId) onScrollToMessage?.(replyId);
  };

  if (isMine) {
    return (
      <div
        data-message-id={message.id}
        className="group relative flex min-w-0 justify-end px-4 py-1.5 sm:px-6"
      >
        <div className="flex min-w-0 max-w-[88%] items-end gap-1.5 sm:max-w-[75%]">
          <time className="mb-1 shrink-0 text-[10px] text-[#8e8e8e]" dateTime={message.created_at}>
            {timeLabel}
          </time>
          <div
            className="min-w-0 rounded-[18px] rounded-br-[4px] px-[14px] py-[10px]"
            style={{ backgroundColor: "#FEE500" }}
          >
            {resolvedReplyTo ? (
              <ReplyPreview replyToMessage={resolvedReplyTo} onClick={handleReplyPreviewClick} />
            ) : null}
            <BubbleContent message={message} isMine isThinking={isThinkingMessage} />
          </div>
          {canDelete && onDelete ? (
            <DeleteButton onClick={handleDeleteClick} disabled={deleting} />
          ) : null}
          {onReply ? <ReplyButton onClick={handleReplyClick} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className="group relative flex min-w-0 justify-start gap-2 px-4 py-1.5 sm:px-6"
    >
      <AvatarCircle initials={initials} bg={avatarColors.bg} text={avatarColors.text} />
      <div className="min-w-0 max-w-[88%] sm:max-w-[75%]">
        <p className="mb-1 flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs font-semibold text-[#0d0d0d]">{senderName}</span>
          {isAi && isPinned ? (
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ background: "#EEEDFE", color: "#3C3489", fontSize: "11px" }}
            >
              📌 위클리 후보
            </span>
          ) : null}
          {message.message_type === "sns_memo" ? (
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ background: "#EEEDFE", color: "#3C3489", fontSize: "11px" }}
            >
              SNS 메모
            </span>
          ) : null}
        </p>
        <div className="flex items-end gap-1.5">
          <div
            className="min-w-0 rounded-[18px] rounded-bl-[4px] px-[14px] py-[10px]"
            style={{
              background: "var(--color-background-primary, #ffffff)",
              border: isAi && isPinned ? "0.5px solid #AFA9EC" : "0.5px solid var(--color-border-tertiary, rgba(0, 0, 0, 0.12))"
            }}
          >
            {resolvedReplyTo ? (
              <ReplyPreview replyToMessage={resolvedReplyTo} onClick={handleReplyPreviewClick} />
            ) : null}
            <BubbleContent message={message} isMine={false} isThinking={isThinkingMessage} />
            {isAi && !isThinkingMessage ? (
              <AiMessageFooter
                message={message}
                isPinned={isPinned}
                pinning={pinning}
                showPinButton={showPinButton}
                currentUserId={currentUserId}
                onPinToggle={() => void handlePinToggle()}
              />
            ) : null}
          </div>
          {canDelete && onDelete ? (
            <DeleteButton onClick={handleDeleteClick} disabled={deleting} />
          ) : null}
          {onReply ? <ReplyButton onClick={handleReplyClick} /> : null}
          <time className="mb-1 shrink-0 text-[10px] text-[#8e8e8e]" dateTime={message.created_at}>
            {timeLabel}
          </time>
        </div>
        {showSnsMemoInput && roomId && currentUserId && meta?.sns_url ? (
          <SnsMemoInput
            lunaMessage={message}
            roomId={roomId}
            currentUserId={currentUserId}
            snsUrl={meta.sns_url}
          />
        ) : null}
      </div>
    </div>
  );
}
