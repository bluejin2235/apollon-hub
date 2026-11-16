/**
 * AI 화면 — kind=bots 응답을 화면용으로 푼다.
 * 회사 막대는 OpenAI·Anthropic·Perplexity·Google·기타 다섯만 보인다.
 * 그 밖 회사(Microsoft·Naver·ByteDance·Apple 등)는 기타에 합친다.
 */

import {
  makeDelta,
  intText,
  type DeltaView
} from "@/components/website/stats/stats-data";
import {
  buildTitles,
  pageTitleFromPath,
  type TitleMap
} from "@/components/website/stats/content-data";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";
import type { StatsBundle } from "@/lib/website/stats";

export const AI_KINDS = ["bots"] as const;

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
  if (!pair) return makeDelta(null, null, "ratio", true, null);
  const current = pairCurrent(pair);
  const previous = typeof pair.previous === "number" ? pair.previous : null;
  return makeDelta(current, previous, "ratio", true, intText(previous));
}

export type AiTopContentRow = {
  path: string;
  title: string;
  langLabel: "국문" | "영문";
  count: number;
};

export function buildAiTopContents(
  payload: BotsStatsPayload | null,
  titles: TitleMap
): AiTopContentRow[] {
  const paths = payload?.ai.topPaths ?? [];
  return paths.slice(0, 5).map((row) => ({
    path: row.path,
    title: pageTitleFromPath(row.path, titles),
    langLabel: row.lang === "en" ? "영문" : "국문",
    count: pairCurrent(row.count)
  }));
}

export function titlesFromCatalog(
  works: WorkListItem[],
  insights: InsightListItem[]
): TitleMap {
  return buildTitles(works, insights);
}
