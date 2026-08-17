import {
  CRON_CONSOLIDATE_HOUR,
  CRON_CONSOLIDATE_MINUTE,
  CRON_EVAL_LIGHT_HOUR,
  CRON_EVAL_LIGHT_MINUTE,
  CRON_SELFSTUDY_HOUR,
  CRON_SELFSTUDY_MINUTE,
  CRON_SELF_UPGRADE_HOUR,
  CRON_SELF_UPGRADE_MINUTE
} from "@/lib/luna/cron-times";

export type InspectPeriod = "daily" | "weekly" | "off";

export type InspectSchedule = {
  period: InspectPeriod;
  /** 0=일 … 6=토 (KST). weekly 일 때만 사용 */
  weekday: number;
  hour: number;
  minute: number;
};

export const INSPECT_SCHEDULE_DEFAULT: InspectSchedule = {
  period: "weekly",
  weekday: 0,
  hour: 4,
  minute: 20
};

/** 점검 시각과 겹치면 안 되는 야간 작업 (KST) */
export const INSPECT_FORBIDDEN_SLOTS: Array<{
  key: string;
  label: string;
  hour: number;
  minute: number;
}> = [
  {
    key: "selfstudy",
    label: "자습",
    hour: CRON_SELFSTUDY_HOUR,
    minute: CRON_SELFSTUDY_MINUTE
  },
  {
    key: "consolidate",
    label: "정리",
    hour: CRON_CONSOLIDATE_HOUR,
    minute: CRON_CONSOLIDATE_MINUTE
  },
  {
    key: "eval-light",
    label: "정기 점검",
    hour: CRON_EVAL_LIGHT_HOUR,
    minute: CRON_EVAL_LIGHT_MINUTE
  },
  {
    key: "self-upgrade",
    label: "자기개선",
    hour: CRON_SELF_UPGRADE_HOUR,
    minute: CRON_SELF_UPGRADE_MINUTE
  }
];

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function coerceInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function kstParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
    weekday: kst.getUTCDay()
  };
}

export function formatTimeHm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_KO[weekday] ?? "?";
}

function matchesMinuteWindow(
  nowMinute: number,
  targetMinute: number,
  window = 10
): boolean {
  return nowMinute >= targetMinute && nowMinute < targetMinute + window;
}

export function normalizeInspectSchedule(raw: unknown): InspectSchedule {
  const d = INSPECT_SCHEDULE_DEFAULT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...d };
  }
  const row = raw as Record<string, unknown>;
  const periodRaw = row.period;
  const period: InspectPeriod =
    periodRaw === "daily" || periodRaw === "weekly" || periodRaw === "off"
      ? periodRaw
      : d.period;
  return {
    period,
    weekday: coerceInt(row.weekday, d.weekday, 0, 6),
    hour: coerceInt(row.hour, d.hour, 0, 23),
    minute: coerceInt(row.minute, d.minute, 0, 59)
  };
}

export function findInspectScheduleConflict(
  schedule: InspectSchedule
): string | null {
  if (schedule.period === "off") return null;
  for (const slot of INSPECT_FORBIDDEN_SLOTS) {
    if (schedule.hour === slot.hour && schedule.minute === slot.minute) {
      return `${formatTimeHm(schedule.hour, schedule.minute)}이 ${slot.label}(${formatTimeHm(slot.hour, slot.minute)})과 겹칩니다`;
    }
  }
  return null;
}

function nextDailyOccurrence(
  hour: number,
  minute: number,
  now = new Date()
): Date {
  const p = kstParts(now);
  const past = p.hour > hour || (p.hour === hour && p.minute >= minute);
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day + (past ? 1 : 0), hour - 9, minute, 0)
  );
}

function nextWeeklyOccurrence(
  weekday: number,
  hour: number,
  minute: number,
  now = new Date()
): Date {
  const p = kstParts(now);
  let add = (weekday - p.weekday + 7) % 7;
  if (add === 0) {
    const past = p.hour > hour || (p.hour === hour && p.minute >= minute);
    if (past) add = 7;
  }
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day + add, hour - 9, minute, 0)
  );
}

export function nextInspectAt(
  schedule: InspectSchedule,
  now = new Date()
): Date | null {
  if (schedule.period === "off") return null;
  if (schedule.period === "daily") {
    return nextDailyOccurrence(schedule.hour, schedule.minute, now);
  }
  return nextWeeklyOccurrence(
    schedule.weekday,
    schedule.hour,
    schedule.minute,
    now
  );
}

/** 예: 다음 점검 8월 16일 (일) 04:20 */
export function formatNextInspectLabel(
  schedule: InspectSchedule,
  now = new Date()
): string {
  if (schedule.period === "off") return "점검 사용 안 함";
  const when = nextInspectAt(schedule, now);
  if (!when) return "점검 사용 안 함";
  const t = kstParts(when);
  return `다음 점검 ${t.month}월 ${t.day}일 (${weekdayLabel(t.weekday)}) ${formatTimeHm(t.hour, t.minute)}`;
}

/**
 * cron(매 10분) 호출 시 실행 여부.
 * period=off → false
 * daily → 매일 설정 시각 ±10분
 * weekly → 설정 요일의 설정 시각 ±10분
 */
export function shouldRunInspectNow(
  schedule: InspectSchedule,
  now = new Date()
): boolean {
  if (schedule.period === "off") return false;
  const p = kstParts(now);
  if (schedule.period === "weekly" && p.weekday !== schedule.weekday) {
    return false;
  }
  if (p.hour !== schedule.hour) return false;
  return matchesMinuteWindow(p.minute, schedule.minute, 10);
}

/** 같은 KST 날짜에 이미 점검했는지 (last_inspect_at 기준) */
export function alreadyInspectedTodayKst(
  lastInspectAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!lastInspectAt) return false;
  const last = new Date(lastInspectAt);
  if (Number.isNaN(last.getTime())) return false;
  const a = kstParts(last);
  const b = kstParts(now);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
