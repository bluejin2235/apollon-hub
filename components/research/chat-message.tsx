"use client";

import type { TrendMessage } from "@/lib/research/types";

type ChatMessageProps = {
  message: TrendMessage;
};

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/[가-힣]/.test(trimmed)) return trimmed.slice(0, 1);
  const parts = trimmed.split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
    : trimmed.slice(0, 2).toUpperCase();
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

function LinkPreviewCard({ message }: { message: TrendMessage }) {
  const url = message.metadata?.url ?? message.content;
  const title = message.metadata?.title ?? url;
  const description = message.metadata?.description;
  const domain = message.metadata?.domain ?? url;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-apollon-300 hover:shadow-sm"
    >
      <div className="px-3 py-2.5">
        <p className="line-clamp-2 text-sm font-medium text-slate-900">{title}</p>
        {description ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{description}</p> : null}
        <p className="mt-1.5 text-[11px] text-slate-400">{domain}</p>
      </div>
    </a>
  );
}

function YoutubePreviewCard({ message }: { message: TrendMessage }) {
  const url = message.metadata?.url ?? message.content;
  const thumbnailUrl = message.metadata?.thumbnailUrl;
  const title = message.metadata?.title ?? message.content;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-apollon-300 hover:shadow-sm"
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="aspect-video w-full max-w-sm object-cover" loading="lazy" />
      ) : null}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-red-600" aria-hidden>
          ▶
        </span>
        <p className="line-clamp-2 text-sm font-medium text-slate-900">{title}</p>
      </div>
    </a>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAi = message.message_type === "ai";
  const senderName = isAi ? "트렌드 레이더 AI" : message.profile?.name?.trim() || "알 수 없음";
  const initials = isAi ? "✦" : getInitials(senderName);

  return (
    <div className={`flex gap-3 px-4 py-2 ${isAi ? "bg-violet-50/60" : ""}`}>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          isAi ? "bg-violet-600 text-white" : "bg-apollon-100 text-apollon-700"
        }`}
        aria-hidden
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-sm font-semibold ${isAi ? "text-violet-800" : "text-slate-900"}`}>{senderName}</span>
          <time className="text-[11px] text-slate-400" dateTime={message.created_at}>
            {formatMessageTime(message.created_at)}
          </time>
        </div>

        {message.message_type === "link" ? (
          <>
            {message.content.trim() !== (message.metadata?.url ?? "") ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{message.content}</p>
            ) : null}
            <LinkPreviewCard message={message} />
          </>
        ) : message.message_type === "youtube" ? (
          <>
            {message.content.trim() !== (message.metadata?.url ?? "") ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{message.content}</p>
            ) : null}
            <YoutubePreviewCard message={message} />
          </>
        ) : message.message_type === "image" && message.metadata?.imageUrl ? (
          <a href={message.metadata.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block">
            <img
              src={message.metadata.imageUrl}
              alt=""
              className="max-h-64 max-w-full rounded-xl border border-slate-200 object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <p
            className={`mt-1 whitespace-pre-wrap break-words text-sm ${
              isAi ? "text-violet-900" : "text-slate-800"
            }`}
          >
            {message.content}
          </p>
        )}
      </div>
    </div>
  );
}
