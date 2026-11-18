/**
 * AI 화면 날짜별 흐름 — 로봇이 읽어 간 횟수(회사별)와 AI 에서 온 방문.
 *
 * 홈페이지 API 의 kind=bots · kind=ai_visits 는 기간 합계만 준다(날짜별 칸이 없다).
 * 그래서 허브가 기간을 날짜(31일 넘으면 7일 묶음)로 잘라 하나씩 받아 잇는다.
 * 홈페이지가 날짜별 칸을 주면 이 파일의 받는 부분만 바꾸면 된다.
 */

import { PREV_REASON } from "@/components/website/stats-v3/v3-data";
import { addIsoDays, inclusiveDays } from "@/components/website/stats-v3/v3-period";
import type { StatsBundle } from "@/lib/website/stats";

/** 날짜로 자를 최대 일수. 넘으면 7일 묶음 */
export const AI_DAYS_MAX_DAILY = 31;
/** 묶음 수 상한 — 1년도 53 묶음 */
export const AI_DAYS_MAX_BUCKETS = 60;

export type AiDayRange = { from: string; to: string };

/**
 * 기간을 날짜(또는 7일 묶음)로 나눈다. 순서는 이른 날부터.
 * 7일로 나누어떨어지지 않으면 마지막 칸이 짧다. 그래서 칸끼리 견줄 때는 합이 아니라 하루 평균으로 견준다(trendFact days).
 */
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
  /** 칸이 품은 날 수. 7일 묶음의 마지막 칸은 7일보다 짧을 수 있다 */
  days: number;
  /** 그중 로봇 기록이 있는 날 수(기록 시작일 since 부터). 로봇 값이 null 이면 0 */
  botDays: number;
  /** 회사별 AI 로봇 횟수. 기록 시작일(since) 앞 날짜면 null */
  botsByCompany: Record<string, number> | null;
  botsTotal: number | null;
  /** AI 서비스에서 온 방문. 응답이 없으면 null */
  visits: number | null;
  /** 응답이 알려 준 로봇 기록 시작일. 응답에 로봇 칸이나 시작일이 없으면 null(확인 안 됨) */
  botsSince: string | null;
};

export type V3AiDays = {
  state: "loading" | "ready" | "error" | "off";
  buckets: AiDayBucket[];
  /** 로봇 기록 시작일 */
  since?: string | null;
  /**
   * buckets 와 같은 자리의 앞 기간 칸(마우스 상자 비교용). 이번 기간 그래프와 따로 받는다.
   * 아직 받는 중이면 null. 칸마다 값(bucket) 또는 비어 있는 까닭(reason)을 둔다.
   */
  previous?: AiPrevSlot[] | null;
};

/** 앞 기간 한 칸: 받은 값, 또는 받지 않았거나 못 받은 까닭 */
export type AiPrevSlot = {
  /** 받을 앞 기간 날짜. 비교 기간 밖이면 null */
  range: AiDayRange | null;
  bucket: AiDayBucket | null;
  /** bucket 이 없는 까닭(비교 기간 밖 · 새 홈페이지 열기 전 · 앞 기간 자료를 받지 못함). bucket 이 있으면 null */
  reason: string | null;
};

/**
 * 받기 전 계획: 칸마다 받을 앞 기간 날짜를 정하고, 받을 수 없는 칸은 까닭을 미리 적는다.
 * 비교 기간 밖이면 「비교 기간 밖」, 칸이 새 홈페이지를 연 날(launch) 전에 걸치면 「새 홈페이지 열기 전」.
 */
export function prevSlotPlan(
  ranges: AiDayRange[],
  from: string,
  prevFrom: string,
  prevTo: string,
  launch: string | null
): AiPrevSlot[] {
  return prevDayRanges(ranges, from, prevFrom, prevTo).map((range) => {
    if (!range) return { range: null, bucket: null, reason: PREV_REASON.outside };
    if (launch && range.from < launch) return { range, bucket: null, reason: PREV_REASON.preLaunch };
    return { range, bucket: null, reason: null };
  });
}

/**
 * 받은 결과를 칸에 붙인다. 받을 칸(reason=null)만 차례로 결과를 쓴다(결과 수 = 받을 칸 수).
 * 실패(ok=false)나 거절(rejected)된 칸만 「앞 기간 자료를 받지 못함」: 나머지 칸은 그대로 비교 값이 붙는다.
 */
export function prevSlotsFrom(
  plan: AiPrevSlot[],
  settled: PromiseSettledResult<{ ok: true; bundle: StatsBundle | null } | { ok: false }>[]
): AiPrevSlot[] {
  let k = 0;
  return plan.map((slot) => {
    if (slot.reason || !slot.range) return slot;
    const result = settled[k++];
    if (!result || result.status === "rejected" || !result.value.ok) {
      return { ...slot, reason: PREV_REASON.failed };
    }
    return { ...slot, bucket: aiDayBucket(slot.range, result.value.bundle), reason: null };
  });
}

/**
 * 로봇 그래프 점의 앞 기간 까닭.
 * 「로봇 기록 시작 전」은 응답이 확인해 준 시작일(botsSince)보다 칸 끝이 앞설 때만 쓴다.
 * 응답은 왔는데 로봇 칸이 없거나 시작일을 모르면 「자료 없음」.
 */
export function botPrevReason(slot: AiPrevSlot | null | undefined): string | null {
  if (!slot) return PREV_REASON.loading;
  if (slot.reason) return slot.reason;
  const bucket = slot.bucket;
  if (bucket?.botsByCompany) return null;
  if (bucket?.botsSince && bucket.to < bucket.botsSince) return PREV_REASON.botsBefore;
  return PREV_REASON.noData;
}

/** 방문 그래프 점의 앞 기간 까닭 */
export function visitPrevReason(slot: AiPrevSlot | null | undefined): string | null {
  if (!slot) return PREV_REASON.loading;
  if (slot.reason) return slot.reason;
  return typeof slot.bucket?.visits === "number" ? null : PREV_REASON.noData;
}

/**
 * 이번 기간 칸과 같은 자리의 앞 기간 칸. 앞 기간 시작(prevFrom)이 이번 시작(from)보다 며칠 앞인지만큼 당긴다
 * (prevDateOf 와 같은 규칙). 앞 기간 밖으로 나가는 쪽은 잘라 내고, 통째로 밖이면 null.
 */
export function prevDayRanges(ranges: AiDayRange[], from: string, prevFrom: string, prevTo: string): (AiDayRange | null)[] {
  if (!from || !prevFrom || !prevTo || prevFrom > prevTo) return ranges.map(() => null);
  const shift = inclusiveDays(prevFrom, from) - 1;
  return ranges.map((range) => {
    const start = addIsoDays(range.from, -shift);
    const end = addIsoDays(range.to, -shift);
    const a = start < prevFrom ? prevFrom : start;
    const b = end > prevTo ? prevTo : end;
    return a <= b ? { from: a, to: b } : null;
  });
}

/** 묶음 칸의 두 날짜 — 「11월 1일~11월 7일 (7일)」. 하루 칸이면 그 날만 */
export function bucketRangeText(bucket: AiDayRange, axis: (iso: string) => string): string {
  if (bucket.from === bucket.to) return axis(bucket.from);
  return `${axis(bucket.from)}~${axis(bucket.to)} (${inclusiveDays(bucket.from, bucket.to)}일)`;
}

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
  const days = inclusiveDays(range.from, range.to);
  const botDays = bots && !beforeSince ? (since && since > range.from ? inclusiveDays(since, range.to) : days) : 0;
  return {
    ...range,
    days,
    botDays,
    botsByCompany: bots && !beforeSince ? byCompany : null,
    botsTotal: bots && !beforeSince ? (typeof bots.ai.total?.current === "number" ? bots.ai.total.current : 0) : null,
    visits: typeof visits?.total === "number" ? visits.total : null,
    botsSince: since
  };
}
