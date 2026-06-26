const LEGACY_ISO_WEEK_LABEL_RE = /^\d{4}-W\d{2}(\s+트렌드방)?$/;

function parseLocalDateString(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "26년 6월 3째주" 형식 (연도 2자리, 월, Math.ceil(일/7)째주) */
export function formatWeekLabel(dateInput: Date | string): string {
  const date = typeof dateInput === "string" ? parseLocalDateString(dateInput) : dateInput;
  const year = date.getFullYear() % 100;
  const month = date.getMonth() + 1;
  const weekOfMonth = Math.ceil(date.getDate() / 7);
  return `${year}년 ${month}월 ${weekOfMonth}째주`;
}

export function isLegacyIsoWeekLabel(label: string): boolean {
  return LEGACY_ISO_WEEK_LABEL_RE.test(label.trim());
}

export function getTrendRoomWeekLabel(room: { week_label: string; week_start: string }): string {
  const trimmed = room.week_label.trim();
  if (!trimmed || isLegacyIsoWeekLabel(trimmed)) {
    return formatWeekLabel(room.week_start);
  }
  return trimmed;
}
