import { formatWeekLabel } from "@/lib/research/week-label";

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
  week_label: string;
  week_start: string;
  week_end: string;
};

export function resolveCreateTrendRoomPayload(weekLabelInput?: string | null): CreateTrendRoomPayload {
  const defaults = buildCurrentWeekRoomFields();
  const week_label = weekLabelInput?.trim() || defaults.week_label;
  return {
    week_label,
    week_start: defaults.week_start,
    week_end: defaults.week_end
  };
}
