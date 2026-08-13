export type PeriodKey = "7" | "30" | "90" | "all" | "custom";

export type SourceMeta = {
  topic?: unknown;
  term_ids?: unknown;
  [key: string]: unknown;
};

export function asTopic(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "미분류";
  const topic = (meta as SourceMeta).topic;
  if (typeof topic !== "string") return "미분류";
  const t = topic.trim();
  return t || "미분류";
}

export function asTermIds(meta: unknown): string[] | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as SourceMeta).term_ids;
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    .map((id) => id.trim());
  return ids;
}

export function sourceTypeLabel(sourceType: string | null | undefined): string {
  if (sourceType === "interview") return "인터뷰";
  if (sourceType === "company_brief" || sourceType === "report") return "리포트";
  if (!sourceType) return "원문";
  return sourceType;
}

/** YYYY-MM-DD in Asia/Seoul */
export function kstYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

export function resolvePeriodRange(
  period: PeriodKey,
  from?: string | null,
  to?: string | null
): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  if (period === "custom") {
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
    const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
    return { from: f, to: t };
  }
  const days = period === "7" ? 7 : period === "90" ? 90 : 30;
  const end = kstYmd();
  const start = addDaysYmd(end, -(days - 1));
  return { from: start, to: end };
}

export function formatRangeLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "전체";
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${y}.${m}.${d}`;
  };
  if (from && to) {
    if (from.slice(0, 4) === to.slice(0, 4)) {
      return `${fmt(from)} – ${to.slice(5).replace("-", ".")}`;
    }
    return `${fmt(from)} – ${fmt(to)}`;
  }
  if (from) return `${fmt(from)} –`;
  return `– ${fmt(to!)}`;
}

export function formatDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const wd = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()] ?? "";
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

export function formatSideDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(2000, m! - 1, d!));
  const wd = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()] ?? "";
  return `${m}월 ${d}일 (${wd})`;
}

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function recentInputLabel(
  spokenAt: string | null | undefined,
  spokenBy: string | null | undefined
): string {
  if (!spokenAt && !spokenBy) return "—";
  let datePart = "—";
  if (spokenAt) {
    const today = kstYmd();
    const yesterday = addDaysYmd(today, -1);
    if (spokenAt === today) datePart = "오늘";
    else if (spokenAt === yesterday) datePart = "어제";
    else {
      const [, m, d] = spokenAt.split("-");
      datePart = `${m}.${d}`;
    }
  }
  const who = spokenBy?.trim() || "—";
  return `${datePart} · ${who}`;
}

export function groupTypeSummary(
  items: { source_type: string }[]
): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    const label = sourceTypeLabel(it.source_type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, n]) => `${label} ${n}편`)
    .join(" · ");
}
