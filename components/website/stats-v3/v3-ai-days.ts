/**
 * AI 화면 날짜별 흐름 — 로봇이 읽어 간 횟수(회사별)와 AI 에서 온 방문.
 *
 * 홈페이지 API 의 kind=bots · kind=ai_visits 는 기간 합계만 준다(날짜별 칸이 없다).
 * 그래서 허브가 기간을 날짜(31일 넘으면 7일 묶음)로 잘라 하나씩 받아 잇는다.
 * 홈페이지가 날짜별 칸을 주면 이 파일의 받는 부분만 바꾸면 된다.
 */

import { addIsoDays, inclusiveDays } from "@/components/website/stats-v3/v3-period";
import type { StatsBundle } from "@/lib/website/stats";

/** 날짜로 자를 최대 일수. 넘으면 7일 묶음 */
export const AI_DAYS_MAX_DAILY = 31;
/** 묶음 수 상한 — 1년도 53 묶음 */
export const AI_DAYS_MAX_BUCKETS = 60;

export type AiDayRange = { from: string; to: string };

/** 기간을 날짜(또는 7일 묶음)로 나눈다. 순서는 이른 날부터 */
export function aiDayRanges(from: string, to: string): AiDayRange[] {
  if (!from || !to || from > to) return [];
  const days = inclusiveDays(from, to);
  const step = days <= AI_DAYS_MAX_DAILY ? 1 : 7;
  const out: AiDayRange[] = [];
  let start = from;
  while (start <= to && out.length < AI_DAYS_MAX_BUCKETS) {
    const end = addIsoDays(start, step - 1);
    out.push({ from: start, to: end > to ? to : end });
    start = addIsoDays(start, step);
  }
  return out;
}

export type AiDayBucket = AiDayRange & {
  /** 회사별 AI 로봇 횟수. 기록 시작일(since) 앞 날짜면 null */
  botsByCompany: Record<string, number> | null;
  botsTotal: number | null;
  /** AI 서비스에서 온 방문. 응답이 없으면 null */
  visits: number | null;
};

export type V3AiDays = {
  state: "loading" | "ready" | "error" | "off";
  buckets: AiDayBucket[];
  /** 로봇 기록 시작일 */
  since?: string | null;
};

/** 하루(또는 묶음) 응답 → 한 칸. since 앞에서 끝나는 칸은 로봇 값을 비운다 */
export function aiDayBucket(range: AiDayRange, bundle: StatsBundle | null): AiDayBucket {
  const bots = bundle?.bots?.bots;
  const since = bots?.since ?? null;
  const beforeSince = since ? range.to < since : false;
  const visits = bundle?.ai_visits?.ai_visits?.current;
  const byCompany: Record<string, number> = {};
  if (bots && !beforeSince) {
    for (const [name, pair] of Object.entries(bots.ai.byCompany ?? {})) {
      byCompany[name] = typeof pair?.current === "number" ? pair.current : 0;
    }
  }
  return {
    ...range,
    botsByCompany: bots && !beforeSince ? byCompany : null,
    botsTotal: bots && !beforeSince ? (typeof bots.ai.total?.current === "number" ? bots.ai.total.current : 0) : null,
    visits: typeof visits?.total === "number" ? visits.total : null
  };
}
