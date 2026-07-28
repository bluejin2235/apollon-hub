"use client";

import { KST_OFFSET_MS } from "@/lib/mail/hub-email";
import { supabase } from "@/lib/supabase/client";

export type StatsPeriodPreset = "today" | "yesterday" | "last_7" | "last_30" | "custom";

export const SERVICE_STATS_LABELS: Record<string, string> = {
  licenses: "라이선스",
  restaurants: "아슐랭",
  supplies: "물품창고",
  agents: "아르테",
  research: "트렌드레이더"
};

export function toKstDateString(utcMs: number = Date.now()): string {
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function resolveStatsPeriod(
  preset: StatsPeriodPreset,
  customStart: string,
  customEnd: string
): { start: string; end: string } {
  const end = toKstDateString();
  if (preset === "today") return { start: end, end };
  if (preset === "yesterday") {
    const yesterday = addDaysIso(end, -1);
    return { start: yesterday, end: yesterday };
  }
  if (preset === "last_7") return { start: addDaysIso(end, -6), end };
  if (preset === "last_30") return { start: addDaysIso(end, -29), end };
  return {
    start: customStart || addDaysIso(end, -29),
    end: customEnd || end
  };
}

export async function fetchStatsApi<T>(path: string): Promise<T> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(body.error || `요청 실패 (${res.status})`);
  }
  return body as T;
}

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** UTF-8 BOM CSV 다운로드 (엑셀 한글 호환) */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const content = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
