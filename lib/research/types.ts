export type TrendMessageType = "text" | "link" | "youtube" | "vimeo" | "image" | "ai";

export type TrendRoom = {
  id: string;
  week_label: string;
  week_start: string;
  week_end: string;
  is_archived: boolean;
  created_at: string;
};

export type TrendMessageMetadata = {
  url?: string;
  title?: string;
  description?: string;
  domain?: string;
  youtubeId?: string;
  vimeoId?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  reply_to_id?: string;
};

export type TrendMessageProfile = {
  id: string;
  name: string;
};

export type TrendMessage = {
  id: string;
  room_id: string;
  profile_id: string | null;
  content: string;
  message_type: TrendMessageType;
  metadata: TrendMessageMetadata | null;
  created_at: string;
  profile?: TrendMessageProfile | null;
  reply_to_id?: string | null;
};

export type TrendAnalysis = {
  id: string;
  message_id: string;
  summary: string;
  keywords: string[] | null;
  relevance_score: number | null;
  apollon_insight: string | null;
  created_at: string;
};

const YOUTUBE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i;
const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

export function extractYoutubeId(text: string): string | null {
  const match = text.match(YOUTUBE_REGEX);
  return match?.[1] ?? null;
}

export function extractVimeoId(text: string): string | null {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?player\.vimeo\.com\/video\/(\d+)/i,
    /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(?:channels\/[^/\s]+\/|groups\/[^/\s]+\/videos\/)(\d+)/i,
    /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match?.[0] ?? null;
}

export function detectMessageType(content: string): TrendMessageType {
  if (extractYoutubeId(content)) return "youtube";
  if (extractVimeoId(content)) return "vimeo";
  if (URL_REGEX.test(content)) return "link";
  return "text";
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function buildMessageMetadata(content: string, messageType: TrendMessageType): TrendMessageMetadata | null {
  if (messageType === "youtube") {
    const youtubeId = extractYoutubeId(content);
    if (!youtubeId) return null;
    const url = extractFirstUrl(content) ?? `https://www.youtube.com/watch?v=${youtubeId}`;
    return {
      url,
      youtubeId,
      thumbnailUrl: `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`,
      domain: "youtube.com"
    };
  }

  if (messageType === "vimeo") {
    const vimeoId = extractVimeoId(content);
    if (!vimeoId) return null;
    const url = extractFirstUrl(content) ?? `https://vimeo.com/${vimeoId}`;
    return {
      url,
      vimeoId,
      domain: "vimeo.com"
    };
  }

  if (messageType === "link") {
    const url = extractFirstUrl(content);
    if (!url) return null;
    return {
      url,
      domain: domainFromUrl(url),
      title: url
    };
  }

  return null;
}

export function isCurrentWeekRoom(room: Pick<TrendRoom, "week_start" | "week_end" | "is_archived">): boolean {
  if (room.is_archived) return false;
  const today = new Date().toISOString().slice(0, 10);
  return room.week_start <= today && room.week_end >= today;
}
