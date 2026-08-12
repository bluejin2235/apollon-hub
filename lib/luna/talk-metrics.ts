import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWeekBounds } from "@/lib/luna/trace-weekly";

export type MessageMeta = Record<string, unknown>;

export type AssistantSignals = {
  thumbsUp: number;
  thumbsDown: number;
  clarify: number;
  searchZero: number;
  requery: number;
  assume: number;
};

export function asMessageMeta(raw: unknown): MessageMeta {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as MessageMeta;
  }
  return {};
}

export function analyzeAssistantMessage(
  content: string,
  meta: MessageMeta
): AssistantSignals {
  const out: AssistantSignals = {
    thumbsUp: 0,
    thumbsDown: 0,
    clarify: 0,
    searchZero: 0,
    requery: 0,
    assume: 0
  };
  if (meta.feedback === "good") out.thumbsUp = 1;
  if (meta.feedback === "bad") out.thumbsDown = 1;
  if (meta.clarify) out.clarify = 1;
  if ("cards" in meta && Array.isArray(meta.cards) && meta.cards.length === 0) {
    out.searchZero = 1;
  }
  if (typeof meta.search_rounds === "number" && meta.search_rounds >= 2) {
    out.requery = 1;
  }
  if (/\[\[\s*가정\s*:/.test(content)) out.assume = 1;
  return out;
}

export function mergeSignals(
  a: AssistantSignals,
  b: AssistantSignals
): AssistantSignals {
  return {
    thumbsUp: a.thumbsUp + b.thumbsUp,
    thumbsDown: a.thumbsDown + b.thumbsDown,
    clarify: a.clarify + b.clarify,
    searchZero: a.searchZero + b.searchZero,
    requery: a.requery + b.requery,
    assume: a.assume + b.assume
  };
}

export function emptySignals(): AssistantSignals {
  return {
    thumbsUp: 0,
    thumbsDown: 0,
    clarify: 0,
    searchZero: 0,
    requery: 0,
    assume: 0
  };
}

export function kstDateRange(
  days: number,
  end = new Date()
): { startIso: string; endIso: string; startLabel: string; endLabel: string } {
  const endParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(end);
  const endYmd = endParts;
  const endDate = new Date(`${endYmd}T23:59:59+09:00`);
  const startDate = new Date(endDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(startDate);
  return {
    startIso: `${startParts}T00:00:00+09:00`,
    endIso: `${endYmd}T23:59:59.999+09:00`,
    startLabel: startParts.replace(/-/g, "."),
    endLabel: endYmd.replace(/-/g, ".")
  };
}

export function parseIsoRange(
  from: string,
  to: string
): { startIso: string; endIso: string; startLabel: string; endLabel: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null;
  }
  return {
    startIso: `${from}T00:00:00+09:00`,
    endIso: `${to}T23:59:59.999+09:00`,
    startLabel: from.replace(/-/g, "."),
    endLabel: to.replace(/-/g, ".")
  };
}

export function weekBucketsInRange(
  startIso: string,
  endIso: string
): Array<{ key: string; label: string; startIso: string; endIso: string }> {
  const buckets: Array<{ key: string; label: string; startIso: string; endIso: string }> =
    [];
  let cursor = new Date(startIso);
  const end = new Date(endIso);
  while (cursor < end && buckets.length < 12) {
    const { weekStart, startIso: ws, endIso: we } = getCurrentWeekBounds(cursor);
    if (buckets.some((b) => b.key === weekStart)) {
      cursor = new Date(we);
      continue;
    }
    const label = `${weekStart.slice(5).replace("-", "/")} 주`;
    buckets.push({ key: weekStart, label, startIso: ws, endIso: we });
    cursor = new Date(we);
  }
  return buckets.slice(-4);
}

export function formatRelativeWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const kstFmt = (dt: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(dt);
  const today = kstFmt(now);
  const that = kstFmt(d);
  const yesterday = kstFmt(new Date(now.getTime() - 86400000));
  const hh = String(
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hour12: false
      }).format(d)
    )
  ).padStart(2, "0");
  const mm = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    minute: "2-digit"
  }).format(d);
  if (that === today) return `오늘 ${hh}:${mm}`;
  if (that === yesterday) return `어제 ${hh}:${mm}`;
  return `${that.slice(5).replace("-", ".")} ${hh}:${mm}`;
}

export function avText(name: string): string {
  const t = name.trim();
  if (!t || t === "—") return "?";
  return t.length >= 2 ? t.slice(0, 2) : t;
}

export const TALK_LINE_COLORS = [
  "#534AB7",
  "#1D9E75",
  "#D85A30",
  "#888780"
] as const;

export function buildConversationSummary(
  messages: Array<{ role: string; content: string; metadata?: unknown }>
): string {
  const parts: string[] = [];
  for (const m of messages) {
    const meta = asMessageMeta(m.metadata);
    const text = m.content.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (m.role === "user") {
      parts.push(text.length > 36 ? `${text.slice(0, 36)}…` : text);
    } else if (meta.clarify) {
      parts.push("되물음");
    } else if (/\[\[\s*가정\s*:/.test(text)) {
      parts.push("가정 확인 후 안내");
    } else if (parts.length === 0 || parts[parts.length - 1] !== "…") {
      const snippet = text.length > 28 ? `${text.slice(0, 28)}…` : text;
      if (parts.length > 0) parts.push("→");
      parts.push(snippet);
    }
    if (parts.join(" ").length > 120) break;
  }
  return parts.join(" ") || "—";
}

export async function scanAssistantSignals(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<AssistantSignals> {
  const { data, error } = await admin
    .from("luna_messages")
    .select("content, metadata")
    .eq("role", "assistant")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .limit(5000);
  if (error) {
    console.error("[luna/talk-metrics] scan", error);
    return emptySignals();
  }
  let acc = emptySignals();
  for (const row of data ?? []) {
    const content = typeof row.content === "string" ? row.content : "";
    acc = mergeSignals(acc, analyzeAssistantMessage(content, asMessageMeta(row.metadata)));
  }
  return acc;
}

export function clarifyRate(signals: AssistantSignals, totalAssistant: number): number | null {
  if (totalAssistant <= 0) return null;
  return Math.round((signals.clarify / totalAssistant) * 100);
}

export function requeryRate(signals: AssistantSignals, searchTurns: number): number | null {
  if (searchTurns <= 0) return null;
  return Math.round((signals.requery / searchTurns) * 100);
}
