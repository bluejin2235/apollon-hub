/**
 * 통계 v3 공통 머리 — 기간 · 비교 줄 · 수집 상태.
 * 지금 화면(website-stats.tsx)의 같은 이름 도우미를 그대로 옮겨 왔다. 그쪽은 내보내지 않아 고치지 않고 복사했다.
 */

import { SITE_LAUNCH_DATE, type ActualCompareRange } from "@/components/website/stats/stats-data";
import type { PeriodPresetId, StatsSyncKindStatus } from "@/lib/website/stats";

export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function addIsoDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return utc.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + months, day));
  return utc.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: PeriodPresetId, today: string): { from: string; to: string } {
  if (preset === "yesterday") {
    const day = addIsoDays(today, -1);
    return { from: day, to: day };
  }
  const end = addIsoDays(today, -1);
  if (preset === "7d") return { from: addIsoDays(end, -6), to: end };
  if (preset === "30d") return { from: addIsoDays(end, -29), to: end };
  if (preset === "3m") return { from: addIsoDays(addMonths(today, -3), -1), to: end };
  if (preset === "6m") return { from: addIsoDays(addMonths(today, -6), -1), to: end };
  if (preset === "1y") return { from: addIsoDays(addMonths(today, -12), -1), to: end };
  return { from: addIsoDays(end, -29), to: end };
}

function isoParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** 시작·끝 포함 일수 */
export function inclusiveDays(from: string, to: string): number {
  const a = isoParts(from);
  const b = isoParts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

function previousRange(from: string, to: string): { from: string; to: string } {
  const length = inclusiveDays(from, to);
  const prevTo = addIsoDays(from, -1);
  return { from: addIsoDays(prevTo, -(length - 1)), to: prevTo };
}

/** 올해가 아니면 해를 붙인다. 11월 11일 · 2025년 11월 11일 */
export function dayText(iso: string, todayYear: number): string {
  const { y, m, d } = isoParts(iso);
  return `${y !== todayYear ? `${y}년 ` : ""}${m}월 ${d}일`;
}

/** 목업 비교 줄의 기간 — 11월 5일 ~ 11월 11일 */
export function rangeText(from: string, to: string, todayYear: number): string {
  if (from === to) return dayText(from, todayYear);
  return `${dayText(from, todayYear)} ~ ${dayText(to, todayYear)}`;
}

/** 끝 글자의 받침으로 조사를 고른다. 한글이 아니면 받침 없음으로 본다 */
export function particle(text: string, withFinal: string, withoutFinal: string): string {
  for (let i = text.length - 1; i >= 0; i--) {
    const code = text.charCodeAt(i);
    if (code === 0x29 || code === 0x20) continue;
    if (code < 0xac00 || code > 0xd7a3) return withoutFinal;
    return (code - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
  }
  return withoutFinal;
}

/** 「A ~ B ↔ C ~ D와 비교」. 어제면 (어제) · (그저께)를 붙인다 */
export function compareLine(
  preset: PeriodPresetId,
  from: string,
  to: string,
  today: string,
  api: ActualCompareRange | null
): string {
  const year = Number(today.slice(0, 4));
  let range: { from: string; to: string; prevFrom: string; prevTo: string } | null = null;
  if (api) {
    range = { from: api.actualFrom, to: api.actualTo, prevFrom: api.prevFrom, prevTo: api.prevTo };
  } else if (from && to && from <= to) {
    const prev = previousRange(from, to);
    range = { from, to, prevFrom: prev.from, prevTo: prev.to };
  }
  if (!range || range.from > range.to) return "";
  const yesterday = preset === "yesterday" && range.from === range.to && range.prevFrom === range.prevTo;
  const before = `${rangeText(range.prevFrom, range.prevTo, year)}${yesterday ? " (그저께)" : ""}`;
  return `${rangeText(range.from, range.to, year)}${yesterday ? " (어제)" : ""} ↔ ${before}${particle(before, "과", "와")} 비교`;
}

export function previousStartsBeforeLaunch(from: string, to: string): boolean {
  if (!SITE_LAUNCH_DATE || !from || !to || from > to) return false;
  return previousRange(from, to).from < SITE_LAUNCH_DATE;
}

const SYNC_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** 서울 시간 「M월 D일 HH:mm」 */
function syncTimeText(iso: string): string {
  const parts = SYNC_TIME_FORMAT.formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("month")}월 ${pick("day")}일 ${pick("hour")}:${pick("minute")}`;
}

const SYNC_KIND_LABEL: Record<string, string> = {
  daily: "일별",
  channel: "유입 경로",
  country: "국가",
  device: "기기",
  page: "페이지",
  query: "검색어",
  event: "이벤트",
  landing: "첫 페이지",
  landing_channel: "경로별 첫 페이지",
  scroll: "읽은 깊이",
  hourly: "시간대"
};

function syncKindName(item: StatsSyncKindStatus): string {
  const source = item.source === "ga4" ? "GA" : item.source === "gsc" ? "검색" : item.source;
  return `${source}·${SYNC_KIND_LABEL[item.kind] ?? item.kind}`;
}

export type SyncLine = { tone: "fail" | "warn" | null; text: string };

/** 수집 상태 한 줄. 실패 → 늦음 → 마지막 수집 순서로 하나만 */
export function syncMainLine(kinds: StatsSyncKindStatus[]): SyncLine | null {
  if (kinds.length === 0) return null;
  const failed = kinds.filter((item) => item.failed);
  if (failed.length > 0) {
    const names = failed.map(syncKindName).join(", ");
    const error = failed.find((item) => item.last_error)?.last_error;
    const errorHead = error ? `${error.slice(0, 60)}${error.length > 60 ? "…" : ""}` : null;
    return { tone: "fail", text: errorHead ? `수집 실패 · ${names} · ${errorHead}` : `수집 실패 · ${names}` };
  }
  const times = kinds
    .map((item) => item.last_ok_at)
    .filter((value): value is string => value !== null)
    .sort();
  if (kinds.some((item) => item.overdue)) {
    const oldest = kinds.some((item) => item.last_ok_at === null) ? null : times[0];
    return {
      tone: "warn",
      text: oldest ? `수집 늦음 · 마지막 수집 ${syncTimeText(oldest)}` : "수집 늦음 · 수집 기록 없음"
    };
  }
  const latest = times[times.length - 1];
  return latest ? { tone: null, text: `마지막 수집 ${syncTimeText(latest)}` } : null;
}
