import type { TrendMessage } from "@/lib/research/types";

export const TREND_MESSAGE_SELECT = `
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

export function mapTrendMessageRow(row: Record<string, unknown>): TrendMessage {
  const profileRaw = row.profile;
  let profile: TrendMessage["profile"] = null;

  if (Array.isArray(profileRaw) && profileRaw[0] && typeof profileRaw[0] === "object") {
    const first = profileRaw[0] as { id: unknown; name: unknown };
    profile = {
      id: String(first.id),
      name: String(first.name ?? "")
    };
  } else if (profileRaw && typeof profileRaw === "object" && !Array.isArray(profileRaw)) {
    profile = {
      id: String((profileRaw as { id: unknown }).id),
      name: String((profileRaw as { name: unknown }).name ?? "")
    };
  }

  const metadata = (row.metadata as TrendMessage["metadata"]) ?? null;
  const replyToId =
    metadata && typeof metadata.reply_to_id === "string" ? metadata.reply_to_id : null;
  const profileIdRaw = row.profile_id ? String(row.profile_id) : profile?.id ?? null;

  return {
    id: String(row.id),
    room_id: String(row.room_id),
    profile_id: profileIdRaw,
    content: String(row.content ?? ""),
    message_type: row.message_type as TrendMessage["message_type"],
    metadata,
    created_at: String(row.created_at),
    profile,
    reply_to_id: replyToId
  };
}

export const MESSAGE_PAGE_DEFAULT_LIMIT = 30;
export const MESSAGE_PAGE_MAX_LIMIT = 100;

export const MESSAGE_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
