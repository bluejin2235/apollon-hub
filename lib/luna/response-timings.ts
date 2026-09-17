/**
 * 루나 답변 단계별 응답 시간 — 답 보낸 뒤 비동기 기록 · 대시보드·약속 점검용 집계
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrafficLight } from "@/lib/luna-admin/traffic";

/** 7일 평균 기준 (ms) */
export const RESPONSE_TIME_YELLOW_MS = 25_000;
export const RESPONSE_TIME_RED_MS = 35_000;

export type ResponseTimingInput = {
  message_id?: string | null;
  conversation_id?: string | null;
  user_id?: string | null;
  embed_ms?: number | null;
  search_ms?: number | null;
  link_ms?: number | null;
  rerank_ms?: number | null;
  llm_ms?: number | null;
  total_ms?: number | null;
  candidates_found?: number | null;
  candidates_added?: number | null;
  candidates_used?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  model?: string | null;
};

export type ResponseTimingStageAvgs = {
  embed_ms: number;
  search_ms: number;
  link_ms: number;
  rerank_ms: number;
  llm_ms: number;
  total_ms: number;
};

export type ResponseTimingDayPoint = {
  /** KST YYYY-MM-DD */
  date: string;
  avg_total_ms: number;
  count: number;
};

export type ResponseTimingDashboard = {
  avg7: ResponseTimingStageAvgs;
  sample_count: number;
  sparkline: ResponseTimingDayPoint[];
  warn_level: TrafficLight;
  yesterday_avg_ms: number | null;
  day_before_avg_ms: number | null;
};

function clampMs(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function lightFromAvg(avgTotalMs: number | null): TrafficLight {
  if (avgTotalMs == null) return "green";
  if (avgTotalMs >= RESPONSE_TIME_RED_MS) return "red";
  if (avgTotalMs >= RESPONSE_TIME_YELLOW_MS) return "yellow";
  return "green";
}

function kstDateKey(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/** 답변 경로를 막지 않도록 fire-and-forget */
export function recordResponseTiming(
  admin: SupabaseClient,
  input: ResponseTimingInput
): void {
  void insertResponseTiming(admin, input);
}

export async function insertResponseTiming(
  admin: SupabaseClient,
  input: ResponseTimingInput
): Promise<void> {
  try {
    const row = {
      message_id: input.message_id ?? null,
      conversation_id: input.conversation_id ?? null,
      user_id: input.user_id ?? null,
      embed_ms: clampMs(input.embed_ms),
      search_ms: clampMs(input.search_ms),
      link_ms: clampMs(input.link_ms),
      rerank_ms:
        input.rerank_ms == null ? null : clampMs(input.rerank_ms),
      llm_ms: clampMs(input.llm_ms),
      total_ms: clampMs(input.total_ms),
      candidates_found: clampMs(input.candidates_found),
      candidates_added: clampMs(input.candidates_added),
      candidates_used: clampMs(input.candidates_used),
      prompt_tokens:
        input.prompt_tokens == null
          ? null
          : Math.max(0, Math.round(input.prompt_tokens)),
      completion_tokens:
        input.completion_tokens == null
          ? null
          : Math.max(0, Math.round(input.completion_tokens)),
      model:
        typeof input.model === "string" && input.model.trim()
          ? input.model.trim()
          : null
    };
    const { error } = await admin.from("luna_response_timings").insert(row);
    if (error) {
      console.error("[luna/response-timings] insert", error);
    }
  } catch (err) {
    console.error("[luna/response-timings] insert", err);
  }
}

type TimingRow = {
  embed_ms: number | null;
  search_ms: number | null;
  link_ms: number | null;
  rerank_ms: number | null;
  llm_ms: number | null;
  total_ms: number | null;
  created_at: string;
};

export async function buildResponseTimingDashboard(
  admin: SupabaseClient,
  now = new Date()
): Promise<ResponseTimingDashboard> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { data, error } = await admin
    .from("luna_response_timings")
    .select(
      "embed_ms, search_ms, link_ms, rerank_ms, llm_ms, total_ms, created_at"
    )
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[luna/response-timings] dashboard", error);
    return {
      avg7: {
        embed_ms: 0,
        search_ms: 0,
        link_ms: 0,
        rerank_ms: 0,
        llm_ms: 0,
        total_ms: 0
      },
      sample_count: 0,
      sparkline: [],
      warn_level: "green",
      yesterday_avg_ms: null,
      day_before_avg_ms: null
    };
  }

  const rows = (data ?? []) as TimingRow[];
  const avg7: ResponseTimingStageAvgs = {
    embed_ms: avg(rows.map((r) => clampMs(r.embed_ms))),
    search_ms: avg(rows.map((r) => clampMs(r.search_ms))),
    link_ms: avg(rows.map((r) => clampMs(r.link_ms))),
    rerank_ms: avg(
      rows
        .map((r) => r.rerank_ms)
        .filter((n): n is number => n != null)
        .map(clampMs)
    ),
    llm_ms: avg(rows.map((r) => clampMs(r.llm_ms))),
    total_ms: avg(rows.map((r) => clampMs(r.total_ms)))
  };

  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const key = kstDateKey(new Date(r.created_at));
    const list = byDay.get(key) ?? [];
    list.push(clampMs(r.total_ms));
    byDay.set(key, list);
  }

  const sparkline: ResponseTimingDayPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = kstDateKey(d);
    const vals = byDay.get(key) ?? [];
    sparkline.push({
      date: key,
      avg_total_ms: vals.length ? avg(vals) : 0,
      count: vals.length
    });
  }

  const yesterdayKey = kstDateKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000)
  );
  const dayBeforeKey = kstDateKey(
    new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  );
  const yVals = byDay.get(yesterdayKey) ?? [];
  const dVals = byDay.get(dayBeforeKey) ?? [];

  return {
    avg7,
    sample_count: rows.length,
    sparkline,
    warn_level: lightFromAvg(rows.length ? avg7.total_ms : null),
    yesterday_avg_ms: yVals.length ? avg(yVals) : null,
    day_before_avg_ms: dVals.length ? avg(dVals) : null
  };
}

export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (s >= 10) return `${s.toFixed(1)}초`;
  if (s >= 1) return `${s.toFixed(1)}초`;
  return `${Math.round(ms)}ms`;
}

export function formatStageBreakdown(avg: ResponseTimingStageAvgs): string {
  return `검색 ${formatSeconds(avg.search_ms)} · 연결 ${formatSeconds(avg.link_ms)} · LLM ${formatSeconds(avg.llm_ms)}`;
}

export async function resolveResponseTimeCheck(
  admin: SupabaseClient,
  now = new Date()
): Promise<{
  lastOkAt: string | null;
  extraDetail?: string;
  light: TrafficLight;
}> {
  const dash = await buildResponseTimingDashboard(admin, now);
  const { data: latest } = await admin
    .from("luna_response_timings")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastOkAt =
    typeof latest?.created_at === "string" ? latest.created_at : null;

  if (dash.sample_count === 0) {
    return {
      lastOkAt,
      light: "green",
      extraDetail: "측정 기록 없음"
    };
  }

  const light = dash.warn_level;
  const detail = `7일 평균 ${formatSeconds(dash.avg7.total_ms)} (${formatStageBreakdown(dash.avg7)}) · n=${dash.sample_count}`;
  return {
    lastOkAt,
    light,
    extraDetail: detail
  };
}

/** 아침 리포트용 추이 한 줄 */
export async function formatResponseTimeMorningLine(
  admin: SupabaseClient,
  now = new Date()
): Promise<string | null> {
  const dash = await buildResponseTimingDashboard(admin, now);
  if (dash.yesterday_avg_ms == null) return null;
  const y = formatSeconds(dash.yesterday_avg_ms);
  if (dash.day_before_avg_ms == null) {
    return `응답 시간 어제 평균 ${y}`;
  }
  return `응답 시간 어제 평균 ${y} (그제 ${formatSeconds(dash.day_before_avg_ms)})`;
}
