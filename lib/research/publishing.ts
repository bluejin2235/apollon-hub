export const PUBLISHING_SCHEDULE_KEY = "publishing_schedule";

export type PublishingPeriod = "1week" | "2week" | "custom";

export type PublishingWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday";

export type PublishingSchedule = {
  day: PublishingWeekday;
  hour: number;
  period: PublishingPeriod;
  start_date?: string;
  end_date?: string;
};

export const DEFAULT_PUBLISHING_SCHEDULE: PublishingSchedule = {
  day: "friday",
  hour: 23,
  period: "1week"
};

export const PUBLISHING_PERIOD_OPTIONS: { value: PublishingPeriod; label: string }[] = [
  { value: "1week", label: "1주일" },
  { value: "2week", label: "2주일" },
  { value: "custom", label: "기간설정" }
];

export const PUBLISHING_WEEKDAY_OPTIONS: { value: PublishingWeekday; label: string }[] = [
  { value: "monday", label: "월" },
  { value: "tuesday", label: "화" },
  { value: "wednesday", label: "수" },
  { value: "thursday", label: "목" },
  { value: "friday", label: "금" }
];

export const PUBLISHING_HOUR_OPTIONS = [18, 19, 20, 21, 22, 23] as const;

const WEEKDAY_LABELS: Record<PublishingWeekday, string> = {
  monday: "월요일",
  tuesday: "화요일",
  wednesday: "수요일",
  thursday: "목요일",
  friday: "금요일"
};

const VALID_WEEKDAYS = new Set<string>(PUBLISHING_WEEKDAY_OPTIONS.map((option) => option.value));
const VALID_PERIODS = new Set<string>(PUBLISHING_PERIOD_OPTIONS.map((option) => option.value));

export function formatPublishingScheduleSummary(schedule: PublishingSchedule): string {
  const dayLabel = WEEKDAY_LABELS[schedule.day];
  const hourLabel = `${schedule.hour}:00`;
  return `매주 ${dayLabel} ${hourLabel} 자동 실행 중`;
}

export function parsePublishingSchedule(value: string | null | undefined): PublishingSchedule {
  if (!value?.trim()) {
    return { ...DEFAULT_PUBLISHING_SCHEDULE };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const day = typeof parsed.day === "string" && VALID_WEEKDAYS.has(parsed.day)
      ? (parsed.day as PublishingWeekday)
      : DEFAULT_PUBLISHING_SCHEDULE.day;
    const hour =
      typeof parsed.hour === "number" &&
      PUBLISHING_HOUR_OPTIONS.includes(parsed.hour as (typeof PUBLISHING_HOUR_OPTIONS)[number])
        ? parsed.hour
        : DEFAULT_PUBLISHING_SCHEDULE.hour;
    const period =
      typeof parsed.period === "string" && VALID_PERIODS.has(parsed.period)
        ? (parsed.period as PublishingPeriod)
        : DEFAULT_PUBLISHING_SCHEDULE.period;
    const start_date = typeof parsed.start_date === "string" ? parsed.start_date : undefined;
    const end_date = typeof parsed.end_date === "string" ? parsed.end_date : undefined;

    return { day, hour, period, start_date, end_date };
  } catch {
    return { ...DEFAULT_PUBLISHING_SCHEDULE };
  }
}

export function serializePublishingSchedule(schedule: PublishingSchedule): string {
  const payload: PublishingSchedule = {
    day: schedule.day,
    hour: schedule.hour,
    period: schedule.period
  };

  if (schedule.period === "custom") {
    payload.start_date = schedule.start_date ?? "";
    payload.end_date = schedule.end_date ?? "";
  }

  return JSON.stringify(payload);
}

export function publishingPeriodToDays(
  period: PublishingPeriod,
  startDate: string,
  endDate: string
): number | null {
  if (period === "1week") return 7;
  if (period === "2week") return 14;

  if (!startDate || !endDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return null;
  }

  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return diffDays > 0 ? diffDays : null;
}

export function buildPublishingTriggerBody(days: number): { days: number } {
  return { days };
}
