/**
 * 요약 화면 루나 총평·할 일 — 브라우저 캐시.
 * DB 칸이 없어 localStorage 에 기간·지문과 함께 둔다.
 * 같은 기간·같은 숫자면 API 를 다시 부르지 않는다.
 */

import { postStatsBrief, type StatsBriefResult, type StatsBriefTodo } from "@/lib/website/api";
import type { ApiResult } from "@/lib/website/types";

const CACHE_PREFIX = "ws-stats-brief:v2:";

/** 같은 지문으로 동시에 두 번 부르지 않는다 (React Strict Mode 포함) */
const inflight = new Map<string, Promise<ApiResult<StatsBriefResult>>>();

export type SummaryBriefCache = {
  fingerprint: string;
  summary: string;
  todos: StatsBriefTodo[];
};

function hashKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function summaryBriefCacheKey(from: string, to: string, fingerprint: string): string {
  return `${CACHE_PREFIX}${from}:${to}:${hashKey(fingerprint)}`;
}

export function readSummaryBriefCache(
  from: string,
  to: string,
  fingerprint: string
): SummaryBriefCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(summaryBriefCacheKey(from, to, fingerprint));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SummaryBriefCache;
    if (
      !parsed ||
      parsed.fingerprint !== fingerprint ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.todos)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSummaryBriefCache(
  from: string,
  to: string,
  fingerprint: string,
  result: StatsBriefResult
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: SummaryBriefCache = {
      fingerprint,
      summary: result.summary,
      todos: result.todos
    };
    window.localStorage.setItem(
      summaryBriefCacheKey(from, to, fingerprint),
      JSON.stringify(payload)
    );
  } catch {
    /* quota 등 — 캐시 실패해도 화면은 동작 */
  }
}

/** localStorage 미스일 때만 Anthropic 을 부른다. 진행 중이면 같은 Promise 를 재사용 */
export function loadSummaryBrief(
  from: string,
  to: string,
  fingerprint: string,
  facts: unknown
): Promise<ApiResult<StatsBriefResult>> {
  const key = summaryBriefCacheKey(from, to, fingerprint);
  const cached = readSummaryBriefCache(from, to, fingerprint);
  if (cached) {
    return Promise.resolve({
      ok: true as const,
      data: { summary: cached.summary, todos: cached.todos },
      status: 200
    });
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = postStatsBrief(facts)
    .then((result) => {
      if (result.ok && result.data?.summary) {
        writeSummaryBriefCache(from, to, fingerprint, result.data);
      }
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

export const TODO_LEVEL_LABEL: Record<StatsBriefTodo["level"], string> = {
  high: "높음",
  mid: "중간",
  low: "낮음"
};
