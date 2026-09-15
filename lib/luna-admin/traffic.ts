export type TrafficLight = "green" | "yellow" | "red";

function kstYmd(now: Date): { year: number; month: number; day: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate()
  };
}

export function kstCalendarDaysAgo(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const a = kstYmd(d);
  const b = kstYmd(now);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((db - da) / 86_400_000);
}

/** 오늘·어제 = 초록, 2일 = 노랑, 3일 이상·없음 = 빨강 */
export function lightFromIdleDays(days: number | null): TrafficLight {
  if (days == null || days >= 3) return "red";
  if (days <= 1) return "green";
  return "yellow";
}

export function worstLight(...lights: TrafficLight[]): TrafficLight {
  if (lights.includes("red")) return "red";
  if (lights.includes("yellow")) return "yellow";
  return "green";
}

export function lightEmoji(light: TrafficLight): string {
  if (light === "green") return "🟢";
  if (light === "yellow") return "🟡";
  return "🔴";
}

export function formatIdleLabel(days: number | null): string {
  if (days == null) return "실행 기록 없음";
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  return `${days}일 전`;
}
