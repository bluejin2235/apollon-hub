"use client";

import { getInitials, getProfileAvatarColors } from "@/lib/research/avatar";
import type { TrendMessage } from "@/lib/research/types";

type ChatMessageProps = {
  message: TrendMessage;
  currentUserId?: string;
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

function formatAiModelLabel(model: string): string | null {
  switch (model) {
    case "claude-sonnet-4-6":
      return "Claude Sonnet 4.6";
    case "youtube-transcript + claude-sonnet-4-6":
      return "youtube-transcript + Claude Sonnet 4.6";
    case "gemini-2.5-flash":
      return "Gemini 2.5 Flash";
    case "gpt-4o":
      return "GPT-4o";
    default:
      return null;
  }
}

function AiModelSource({ message }: { message: TrendMessage }) {
  const aiModel = (message.metadata as { ai_model?: string } | null)?.ai_model;
  const label = aiModel ? formatAiModelLabel(aiModel) : null;
  if (!label) return null;

  return (
    <p className="mt-1 text-[10px]" style={{ color: "var(--color-text-tertiary, #8e8e8e)" }}>
      {label}
    </p>
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

function BubbleContent({ message, isMine }: { message: TrendMessage; isMine: boolean }) {
  const isAi = message.message_type === "ai";
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

  return (
    <>
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${textClass}`}>{message.content}</p>
      {isAi ? <AiModelSource message={message} /> : null}
    </>
  );
}

export function ChatMessage({ message, currentUserId }: ChatMessageProps) {
  const isAi = message.message_type === "ai";
  const isMine = Boolean(currentUserId && message.profile_id === currentUserId && !isAi);
  const senderName = isAi ? "루나 (Luna)" : message.profile?.name?.trim() || "알 수 없음";
  const initials = isAi ? "L" : getInitials(senderName);
  const avatarColors = isAi
    ? { bg: "#534AB7", text: "#FFFFFF" }
    : getProfileAvatarColors(message.profile_id);
  const timeLabel = formatBubbleTime(message.created_at);

  if (isMine) {
    return (
      <div className="flex justify-end px-4 py-1.5 sm:px-6">
        <div className="flex max-w-[75%] items-end gap-1.5">
          <time className="mb-1 shrink-0 text-[10px] text-[#8e8e8e]" dateTime={message.created_at}>
            {timeLabel}
          </time>
          <div
            className="rounded-[18px] rounded-br-[4px] px-[14px] py-[10px]"
            style={{ backgroundColor: "#FEE500" }}
          >
            <BubbleContent message={message} isMine />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2 px-4 py-1.5 sm:px-6">
      <AvatarCircle initials={initials} bg={avatarColors.bg} text={avatarColors.text} />
      <div className="min-w-0 max-w-[75%]">
        <p className="mb-1 px-1 text-xs font-semibold text-[#0d0d0d]">{senderName}</p>
        <div className="flex items-end gap-1.5">
          <div
            className="rounded-[18px] rounded-bl-[4px] px-[14px] py-[10px]"
            style={{
              background: "var(--color-background-primary, #ffffff)",
              border: "0.5px solid var(--color-border-tertiary, rgba(0, 0, 0, 0.12))"
            }}
          >
            <BubbleContent message={message} isMine={false} />
          </div>
          <time className="mb-1 shrink-0 text-[10px] text-[#8e8e8e]" dateTime={message.created_at}>
            {timeLabel}
          </time>
        </div>
      </div>
    </div>
  );
}
