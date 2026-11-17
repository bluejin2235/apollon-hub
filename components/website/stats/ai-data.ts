/**
 * AI 화면 — kind=bots 응답을 화면용으로 푼다.
 * 회사 막대는 OpenAI·Anthropic·Perplexity·Google·기타 다섯만 보인다.
 * 그 밖 회사(Microsoft·Naver·ByteDance·Apple 등)는 기타에 합친다.
 */

import {
  makeCountDelta,
  intText,
  previousIsOldSite,
  type DeltaView
} from "@/components/website/stats/stats-data";
import {
  buildTitles,
  pageTitleFromPath,
  type TitleMap
} from "@/components/website/stats/content-data";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";
import type { StatsBundle } from "@/lib/website/stats";

export const AI_KINDS = ["bots", "ai_visits"] as const;

export type BotsCountPair = {
  current: number;
  previous: number | null;
};

export type BotsTopPath = {
  path: string;
  lang: "ko" | "en";
  count: BotsCountPair;
};

export type BotsStatsPayload = {
  since: string;
  ai: {
    total: BotsCountPair;
    byCompany: Record<string, BotsCountPair>;
    byPurpose: Record<string, BotsCountPair>;
    askedTotal: BotsCountPair;
    topPaths: BotsTopPath[];
    failed: BotsCountPair;
  };
  searchEngines: {
    total: BotsCountPair;
    byName: Record<string, BotsCountPair>;
  };
  verified: boolean;
};

/** 화면에 그리는 회사 순서 */
export const AI_COMPANY_BARS = [
  "OpenAI",
  "Anthropic",
  "Perplexity",
  "Google",
  "기타"
] as const;

export type AiCompanyBarName = (typeof AI_COMPANY_BARS)[number];

export function readBotsPayload(bundle: StatsBundle | null): BotsStatsPayload | null {
  const result = bundle?.bots;
  const payload = result?.bots;
  if (!payload || typeof payload !== "object") return null;
  if (!payload.ai || !payload.searchEngines) return null;
  return payload;
}

function pairCurrent(pair: BotsCountPair | undefined): number {
  return typeof pair?.current === "number" ? pair.current : 0;
}

/** 회사별 가로 막대 행. 값이 모두 0 이어도 다섯 칸을 유지한다 */
export function buildAiCompanyBars(
  payload: BotsStatsPayload | null
): { name: string; value: number }[] {
  const byCompany = payload?.ai.byCompany ?? {};
  const totals: Record<AiCompanyBarName, number> = {
    OpenAI: 0,
    Anthropic: 0,
    Perplexity: 0,
    Google: 0,
    기타: 0
  };

  for (const [name, pair] of Object.entries(byCompany)) {
    const value = pairCurrent(pair);
    if (name === "OpenAI" || name === "Anthropic" || name === "Perplexity" || name === "Google") {
      totals[name] += value;
    } else {
      totals["기타"] += value;
    }
  }

  return AI_COMPANY_BARS.map((name) => ({ name, value: totals[name] }));
}

export function countDelta(pair: BotsCountPair | undefined): DeltaView {
  if (!pair) return makeCountDelta(null, null, true, null);
  const current = pairCurrent(pair);
  const previous = typeof pair.previous === "number" ? pair.previous : null;
  return makeCountDelta(current, previous, true, intText(previous));
}

/** 목적별 막대 — 기획서 학습용 · 검색용 · 물어봐서 */
export const AI_PURPOSE_BARS = [
  { key: "학습", label: "학습용" },
  { key: "검색", label: "검색용" },
  { key: "물어봐서 읽음", label: "물어봐서" }
] as const;

export function buildAiPurposeBars(
  payload: BotsStatsPayload | null
): { name: string; value: number }[] {
  const byPurpose = payload?.ai.byPurpose ?? {};
  return AI_PURPOSE_BARS.map(({ key, label }) => ({
    name: label,
    value: pairCurrent(byPurpose[key])
  }));
}

export const AI_TOP_PAGES = 10;
export const LLMS_TXT_PATH = "/llms.txt";

export type AiTopContentRow = {
  path: string;
  title: string;
  langLabel: "국문" | "영문";
  count: number;
  delta: DeltaView;
  /** llms.txt 고정 줄 */
  fixed?: boolean;
};

function isLlmsTxtPath(path: string): boolean {
  const raw = path.trim().toLowerCase();
  return raw === "/llms.txt" || raw.endsWith("/llms.txt");
}

/**
 * 많이 읽은 페이지 10 + llms.txt 고정 한 줄.
 * llms.txt 가 상위 10에 있으면 목록에서는 빼고 고정 줄에만 둔다.
 */
export function buildAiTopContents(
  payload: BotsStatsPayload | null,
  titles: TitleMap
): { rows: AiTopContentRow[]; llms: AiTopContentRow } {
  const paths = payload?.ai.topPaths ?? [];
  const llmsHit = paths.find((row) => isLlmsTxtPath(row.path));
  const llmsPair = llmsHit?.count;
  const llms: AiTopContentRow = {
    path: LLMS_TXT_PATH,
    title: "llms.txt",
    langLabel: "국문",
    count: pairCurrent(llmsPair),
    delta: countDelta(llmsPair),
    fixed: true
  };

  const rows = paths
    .filter((row) => !isLlmsTxtPath(row.path))
    .slice(0, AI_TOP_PAGES)
    .map((row) => ({
      path: row.path,
      title: pageTitleFromPath(row.path, titles),
      langLabel: (row.lang === "en" ? "영문" : "국문") as "국문" | "영문",
      count: pairCurrent(row.count),
      delta: countDelta(row.count)
    }));

  return { rows, llms };
}

/** 고른 기간 끝이 로봇 기록 시작일 앞이면 참 — 빈 상태 「기간을 바꿔 보세요」 */
export function botsPeriodBeforeSince(bundle: StatsBundle | null): boolean {
  const result = bundle?.bots;
  if (!result) return false;
  const payload = result.bots;
  const since = payload?.since?.trim();
  if (!since) return false;
  const to = (result.actual_to ?? result.to)?.trim();
  return Boolean(to && to < since);
}

/* ─────────────────────── ③ 사람이 옴 — kind=ai_visits ─────────────────────── */

export type AiVisitsPeriod = {
  total: number;
  /** 세션 많은 순 */
  by_name: { name: string; sessions: number }[];
  /** 세션 많은 순. 홈페이지가 주는 만큼만 있다 */
  top_pages: { path: string; lang: "ko" | "en"; sessions: number }[];
};

export type AiVisits = {
  current: AiVisitsPeriod;
  /** 앞 기간이 오픈 전이면 null — 화면은 「비교 불가」 */
  previous: AiVisitsPeriod | null;
};

function readAiVisitsPeriod(value: unknown): AiVisitsPeriod | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.total !== "number") return null;
  const byName = Array.isArray(record.by_name) ? record.by_name : [];
  const topPages = Array.isArray(record.top_pages) ? record.top_pages : [];
  return {
    total: record.total,
    by_name: byName
      .filter(
        (row): row is { name: string; sessions: number } =>
          Boolean(row) && typeof row.name === "string" && typeof row.sessions === "number"
      )
      .map((row) => ({ name: row.name, sessions: row.sessions })),
    top_pages: topPages
      .filter(
        (row): row is { path: string; lang: unknown; sessions: number } =>
          Boolean(row) && typeof row.path === "string" && typeof row.sessions === "number"
      )
      .map((row) => ({
        path: row.path,
        lang: row.lang === "en" ? "en" : "ko",
        sessions: row.sessions
      }))
  };
}

/**
 * kind=ai_visits 응답. 응답이 없거나 모양이 다르면 null.
 * 앞 기간이 오픈 전이면 previous 를 비운다 — 요약 카드와 같은 기준(previousIsOldSite).
 */
export function readAiVisits(bundle: StatsBundle | null): AiVisits | null {
  const payload = bundle?.ai_visits?.ai_visits;
  const current = readAiVisitsPeriod(payload?.current);
  if (!current) return null;
  const previous = previousIsOldSite(bundle) ? null : readAiVisitsPeriod(payload?.previous);
  return { current, previous };
}

/**
 * 「AI 에서 온 방문」 카드 숫자. AI 화면과 요약 화면이 둘 다 이것만 쓴다.
 * 응답이 없으면 null.
 */
export function aiVisitsSummary(
  bundle: StatsBundle | null,
  previousLabel: (value: number | null) => string | null = intText
): { total: number; delta: DeltaView } | null {
  const visits = readAiVisits(bundle);
  if (!visits) return null;
  const previous = visits.previous?.total ?? null;
  return {
    total: visits.current.total,
    delta: makeCountDelta(visits.current.total, previous, true, previousLabel(previous))
  };
}

/** 화면에 그리는 AI 서비스 순서. 홈페이지 분류(source-class)의 이름과 같다 */
export const AI_VISIT_BARS = [
  "ChatGPT",
  "Claude",
  "Perplexity",
  "Gemini",
  "Copilot",
  "그 밖"
] as const;

type AiVisitBarName = (typeof AI_VISIT_BARS)[number];

/** AI 별 가로 막대. 값이 모두 0 이어도 여섯 칸을 유지한다 */
export function buildAiVisitBars(visits: AiVisits | null): { name: string; value: number }[] {
  const totals = Object.fromEntries(AI_VISIT_BARS.map((name) => [name, 0])) as Record<
    AiVisitBarName,
    number
  >;
  for (const row of visits?.current.by_name ?? []) {
    const name = (AI_VISIT_BARS as readonly string[]).includes(row.name)
      ? (row.name as AiVisitBarName)
      : "그 밖";
    totals[name] += row.sessions;
  }
  return AI_VISIT_BARS.map((name) => ({ name, value: totals[name] }));
}

export const AI_VISIT_PAGES = 10;

export type AiVisitPageRow = {
  path: string;
  title: string;
  langLabel: "국문" | "영문";
  sessions: number;
  delta: DeltaView;
};

/**
 * 앞 기간 그 페이지 세션.
 * 앞 기간 목록이 전부(합 = total)면 목록에 없는 페이지는 0, 잘린 목록이면 알 수 없어 null.
 */
function previousPageSessions(previous: AiVisitsPeriod | null, path: string, lang: "ko" | "en") {
  if (!previous) return null;
  const hit = previous.top_pages.find((row) => row.path === path && row.lang === lang);
  if (hit) return hit.sessions;
  const listed = previous.top_pages.reduce((sum, row) => sum + row.sessions, 0);
  return listed === previous.total ? 0 : null;
}

export function buildAiVisitPages(visits: AiVisits | null, titles: TitleMap): AiVisitPageRow[] {
  if (!visits) return [];
  return visits.current.top_pages.slice(0, AI_VISIT_PAGES).map((row) => {
    const previous = previousPageSessions(visits.previous, row.path, row.lang);
    return {
      path: row.path,
      title: pageTitleFromPath(row.path, titles),
      langLabel: row.lang === "en" ? "영문" : "국문",
      sessions: row.sessions,
      delta: makeCountDelta(row.sessions, previous, true, intText(previous))
    };
  });
}

export function titlesFromCatalog(
  works: WorkListItem[],
  insights: InsightListItem[]
): TitleMap {
  return buildTitles(works, insights);
}
