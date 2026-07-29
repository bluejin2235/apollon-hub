const AVATAR_PALETTE = [
  { bg: "#E3F2FD", text: "#1565C0" },
  { bg: "#F3E5F5", text: "#7B1FA2" },
  { bg: "#E8F5E9", text: "#2E7D32" },
  { bg: "#FFF3E0", text: "#E65100" },
  { bg: "#FCE4EC", text: "#C2185B" },
  { bg: "#E0F7FA", text: "#00838F" },
  { bg: "#F1F8E9", text: "#558B2F" },
  { bg: "#EDE7F6", text: "#4527A0" }
] as const;

export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/[가-힣]/.test(trimmed)) return trimmed.slice(0, 1);
  const parts = trimmed.split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
    : trimmed.slice(0, 2).toUpperCase();
}

export function getProfileAvatarColors(profileId: string | null | undefined): { bg: string; text: string } {
  if (!profileId) {
    return { bg: "#E5E5E5", text: "#737373" };
  }

  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash + profileId.charCodeAt(i) * (i + 1)) % AVATAR_PALETTE.length;
  }

  return AVATAR_PALETTE[hash] ?? AVATAR_PALETTE[0];
}

export type ParticipantInfo = {
  id: string;
  name: string;
};

export function collectParticipants(messages: { profile_id: string | null; profile?: { id: string; name: string } | null }[]): ParticipantInfo[] {
  const map = new Map<string, ParticipantInfo>();

  for (const message of messages) {
    if (!message.profile_id) continue;
    if (map.has(message.profile_id)) continue;
    map.set(message.profile_id, {
      id: message.profile_id,
      name: message.profile?.name?.trim() || "?"
    });
  }

  return [...map.values()];
}
