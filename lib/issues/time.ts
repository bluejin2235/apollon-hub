const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstParts(iso: string): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  ms: number;
} | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const kst = new Date(ms + KST_OFFSET_MS);
  return {
    y: kst.getUTCFullYear(),
    m: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
    h: kst.getUTCHours(),
    min: kst.getUTCMinutes(),
    ms
  };
}

function kstToday(): { y: number; m: number; d: number; startMs: number } {
  const now = Date.now() + KST_OFFSET_MS;
  const t = new Date(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  return { y, m: m + 1, d, startMs: Date.UTC(y, m, d) - KST_OFFSET_MS };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ampm(h: number, min: number): string {
  const period = h < 12 ? "오전" : "오후";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${hour12}:${pad2(min)}`;
}

/** 목록 보조줄: 2시간 전 · 어제 · 3일 전 · 2주 전 */
export function formatIssueAgo(iso: string, nowMs = Date.now()): string {
  const parts = kstParts(iso);
  if (!parts) return "—";
  const diff = nowMs - parts.ms;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 3_600_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  const today = kstToday();
  const startToday = today.startMs;
  const startYesterday = startToday - 86_400_000;
  if (parts.ms >= startYesterday && parts.ms < startToday) return "어제";
  const days = Math.floor((startToday - parts.ms) / 86_400_000) + 1;
  if (days < 14) return `${days}일 전`;
  const weeks = Math.floor(days / 7);
  return `${weeks}주 전`;
}

/** 상세: 어제 오후 3:14 · 오늘 오전 11:30 */
export function formatIssueWhen(iso: string): string {
  const parts = kstParts(iso);
  if (!parts) return "—";
  const today = kstToday();
  const startToday = today.startMs;
  const startYesterday = startToday - 86_400_000;
  const clock = ampm(parts.h, parts.min);
  if (parts.ms >= startToday) return `오늘 ${clock}`;
  if (parts.ms >= startYesterday) return `어제 ${clock}`;
  return `${parts.m}월 ${parts.d}일 ${clock}`;
}

export function kstDayWindow(nowMs = Date.now()): { startIso: string; endIso: string } {
  const today = kstToday();
  void nowMs;
  return {
    startIso: new Date(today.startMs).toISOString(),
    endIso: new Date(today.startMs + 86_400_000).toISOString()
  };
}

export function kstHour(nowMs = Date.now()): number {
  return new Date(nowMs + KST_OFFSET_MS).getUTCHours();
}
