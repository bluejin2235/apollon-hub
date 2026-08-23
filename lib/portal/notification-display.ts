/**
 * 알림 페이지 — 표시·필터·동작 (서버 전용 의존 없음)
 */
import { LUNA_LINKS } from "@/lib/luna/notify";

export type NotificationFilter =
  | "all"
  | "unread"
  | "luna"
  | "nas"
  | "wiki"
  | "problem";

export type NotificationLevel = "success" | "info" | "warn" | "error";

export const NOTIFICATION_FILTERS: Array<{
  key: NotificationFilter;
  label: string;
}> = [
  { key: "all", label: "전체" },
  { key: "unread", label: "안 읽음" },
  { key: "luna", label: "루나" },
  { key: "nas", label: "Work서버" },
  { key: "wiki", label: "위키" },
  { key: "problem", label: "문제" }
];

export const CATEGORY_PREF_LABEL: Record<string, string> = {
  luna_reflect: "루나 자습 완료",
  wiki_rules: "위키 규칙 변경",
  nas_scan: "Work서버 스캔",
  luna_exam: "루나 정기 점검",
  luna_morning: "아침 브리핑",
  luna_conflict: "위키와 다른 정정",
  luna_prompt: "모델·프롬프트 변경",
  luna_report: "주간 보고",
  luna_consolidation: "지식 통합",
  luna_notion_index: "노션 색인",
  luna_study: "자습"
};

export function categoryPrefLabel(category: string): string {
  return CATEGORY_PREF_LABEL[category] ?? category;
}

export function categoryBadge(category: string): string {
  if (category === "luna_exam") return "점검";
  if (category === "nas_scan") return "Work서버";
  if (category === "wiki_rules") return "위키";
  if (category === "luna_notion_index") return "노션";
  if (category.startsWith("luna_")) return "루나";
  return "알림";
}

export function normalizeLevel(level: string | null | undefined): NotificationLevel {
  if (level === "success" || level === "warn" || level === "error") return level;
  return "info";
}

export function levelIcon(level: NotificationLevel, category: string): string {
  if (category === "luna_morning") return "☀";
  if (category === "luna_reflect" || category === "luna_study") return "🌙";
  if (category === "wiki_rules") return "📗";
  if (level === "success") return "✓";
  if (level === "warn") return "⚠";
  if (level === "error") return "⚠";
  return "ℹ";
}

export type NotificationAction = { href: string; label: string };

const CATEGORY_ACTION: Record<string, NotificationAction> = {
  luna_exam: { href: LUNA_LINKS.failures, label: "실패 수집에서 보기" },
  nas_scan: { href: LUNA_LINKS.knowledgeWorkserver, label: "Work서버 설정" },
  luna_notion_index: { href: LUNA_LINKS.knowledgeNotion, label: "노션 설정 열기" },
  luna_morning: { href: LUNA_LINKS.dashboard, label: "대시보드 열기" },
  luna_reflect: { href: LUNA_LINKS.candidatesPending, label: "지식 후보 열기" },
  luna_consolidation: {
    href: LUNA_LINKS.candidatesPending,
    label: "지식 후보 열기"
  },
  luna_conflict: { href: LUNA_LINKS.knowledgeConflict, label: "충돌 보기" },
  luna_prompt: { href: LUNA_LINKS.brainUpgrade, label: "두뇌 열기" },
  luna_report: { href: LUNA_LINKS.brainReport, label: "보고 열기" },
  luna_study: { href: LUNA_LINKS.selfstudyHistory, label: "자습 기록 보기" }
};

export function parseNotificationFilter(
  raw: string | null | undefined
): NotificationFilter {
  if (
    raw === "unread" ||
    raw === "luna" ||
    raw === "nas" ||
    raw === "wiki" ||
    raw === "problem"
  ) {
    return raw;
  }
  return "all";
}

export function notificationAction(
  category: string,
  link: string | null | undefined
): NotificationAction | null {
  if (category === "wiki_rules") {
    if (link) return { href: link, label: "문서 열기" };
    return {
      href: LUNA_LINKS.candidatesPending,
      label: "지식 후보 열기"
    };
  }
  const mapped = CATEGORY_ACTION[category];
  if (mapped) return mapped;
  if (link) return { href: link, label: "자세히" };
  return null;
}

export function formatMetaLine(
  meta: Record<string, unknown> | null | undefined
): string | null {
  if (!meta || typeof meta !== "object") return null;
  const skip = new Set(["event", "parts", "failed_cases", "start", "end"]);
  const bits: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (skip.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "object") continue;
    bits.push(`${k}=${String(v)}`);
    if (bits.length >= 6) break;
  }
  if (bits.length === 0) return null;
  return bits.join(" · ");
}

export function notificationBody(
  body: string | null | undefined,
  meta: Record<string, unknown> | null | undefined
): string | null {
  const parts = meta?.parts;
  if (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((p) => typeof p === "string")
  ) {
    return (parts as string[]).join("\n");
  }
  const text = (body ?? "").trim();
  return text.length > 0 ? (body as string) : null;
}

export type DateGroupKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "older";

export const DATE_GROUP_LABEL: Record<DateGroupKey, string> = {
  today: "오늘",
  yesterday: "어제",
  this_week: "이번 주",
  last_week: "지난 주",
  older: "그 이전"
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstYmd(ms: number): { y: number; m: number; d: number } {
  const t = new Date(ms + KST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

function kstMidnightUtc(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d) - KST_OFFSET_MS;
}

export function dateGroupKey(iso: string, nowMs = Date.now()): DateGroupKey {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "older";
  const today = kstYmd(nowMs);
  const startToday = kstMidnightUtc(today.y, today.m, today.d);
  const startYesterday = startToday - 86400000;
  const todayDate = new Date(Date.UTC(today.y, today.m, today.d));
  const mondayOffset = (todayDate.getUTCDay() + 6) % 7;
  const startThisWeek = startToday - mondayOffset * 86400000;
  const startLastWeek = startThisWeek - 7 * 86400000;
  if (t >= startToday) return "today";
  if (t >= startYesterday) return "yesterday";
  if (t >= startThisWeek) return "this_week";
  if (t >= startLastWeek) return "last_week";
  return "older";
}

export function groupNotificationsByDate<T extends { created_at: string }>(
  items: T[],
  nowMs = Date.now()
): Array<{ key: DateGroupKey; label: string; items: T[] }> {
  const order: DateGroupKey[] = [
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "older"
  ];
  const buckets = new Map<DateGroupKey, T[]>();
  for (const item of items) {
    const key = dateGroupKey(item.created_at, nowMs);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  return order
    .filter((k) => (buckets.get(k) ?? []).length > 0)
    .map((k) => ({
      key: k,
      label: DATE_GROUP_LABEL[k],
      items: buckets.get(k) ?? []
    }));
}

export function formatCardTime(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const group = dateGroupKey(iso, nowMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (group === "today") return `${hh}:${mm}`;
  if (group === "yesterday") return `어제 ${hh}:${mm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export const NOTIFICATIONS_SETTINGS_URL = "/settings?tab=notifications";

export const HUB_NOTIFICATIONS_CHANGED = "hub-notifications-changed";

export function emitHubNotificationsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HUB_NOTIFICATIONS_CHANGED));
}
