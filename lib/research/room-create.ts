import { formatWeekLabel } from "@/lib/research/week-label";
import type { TrendRoomType } from "@/lib/research/types";

export const PERSONAL_ROOM_DEFAULT_NAME = "나와 루나";

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildCurrentWeekRoomFields(date = new Date()) {
  const monday = new Date(date);
  const dow = monday.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    week_label: formatWeekLabel(monday),
    week_start: formatLocalDate(monday),
    week_end: formatLocalDate(sunday)
  };
}

export type CreateTrendRoomPayload = {
  room_type: TrendRoomType;
  owner_id: string | null;
  name: string;
  week_label: string;
  week_start: string;
  week_end: string;
};

export function resolvePersonalRoomPayload(
  ownerId: string,
  nameInput?: string | null
): CreateTrendRoomPayload {
  const { week_start, week_end } = buildCurrentWeekRoomFields();
  const name = nameInput?.trim() || PERSONAL_ROOM_DEFAULT_NAME;
  return {
    room_type: "personal",
    owner_id: ownerId,
    name,
    week_label: name,
    week_start,
    week_end
  };
}

export function resolvePublicRoomPayload(nameInput?: string | null): CreateTrendRoomPayload {
  const defaults = buildCurrentWeekRoomFields();
  const name = nameInput?.trim() || defaults.week_label;
  return {
    room_type: "public",
    owner_id: null,
    name,
    week_label: name,
    week_start: defaults.week_start,
    week_end: defaults.week_end
  };
}

/** @deprecated `resolvePublicRoomPayload` 사용 */
export function resolveGroupRoomPayload(nameInput?: string | null): CreateTrendRoomPayload {
  return resolvePublicRoomPayload(nameInput);
}

/** @deprecated `resolvePublicRoomPayload` 사용 */
export function resolveCreateTrendRoomPayload(weekLabelInput?: string | null): CreateTrendRoomPayload {
  return resolvePublicRoomPayload(weekLabelInput);
}

export function normalizeCreateRoomType(value?: string | null): TrendRoomType {
  if (value === "personal") return "personal";
  if (value === "public" || value === "group") return "public";
  return "public";
}
