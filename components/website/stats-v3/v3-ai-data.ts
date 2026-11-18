/**
 * AI 화면 v3 — 세 질문
 *   ① AI가 우리 사이트를 읽어 갔나 (kind=bots, 로봇 기록은 2026-11-16 부터)
 *   ② AI 답변에 우리가 나오나 (stats/ai-answers, 사람이 직접 물어본 기록)
 *   ③ AI 답변을 보고 사람이 왔나 (kind=ai_visits, GA 출처가 AI 서비스인 방문)
 *
 * ① 은 회사별로 나누고, 회사마다 무엇에 쓰는 로봇인지 쉬운 말을 붙인다. 검색 엔진 로봇(구글 · 빙 · 네이버)은
 * AI 가 아니어서 따로 「참고」로 보인다. 홈페이지 분류 목록에 없는 이름은 「회사를 알 수 없는 로봇」으로 두고,
 * 홈페이지가 이름별 숫자(ai.byName)를 주면 허브가 이름으로 회사를 찾아 옮기고 남은 이름을 그대로 적는다.
 */

import {
  aiVisitsSummary,
  buildAiTopContents,
  buildAiVisitPages,
  countDelta,
  readAiVisits,
  type AiVisitPageRow,
  type AiVisits,
  type BotsCountPair,
  type BotsStatsPayload
} from "@/components/website/stats/ai-data";
import type { TitleMap } from "@/components/website/stats/content-data";
import { intText, makeCountDelta, type DeltaView } from "@/components/website/stats/stats-data";
import type { HBarRow } from "@/components/website/stats-v3/v3-parts";
import type { StatsBundle } from "@/lib/website/stats";

export { botsPeriodBeforeSince, readAiVisits, readBotsPayload } from "@/components/website/stats/ai-data";

const unit = (value: number | null) => (value == null ? null : `${intText(value)}회`);

/** 개수 증감 + 「앞 기간 N회」 */
export function botsDelta(pair: BotsCountPair | undefined, higherIsBetter = true): DeltaView {
  const view = countDelta(pair, higherIsBetter);
  return view.previous == null ? view : { ...view, previous: `${view.previous}회` };
}

/* ─────────────────────── ① 읽어 갔나 ─────────────────────── */

/** 홈페이지 회사 이름 → 화면 이름 · 무엇에 쓰는 로봇인지 */
export const AI_COMPANY_INFO: Record<string, { name: string; purpose: string }> = {
  OpenAI: { name: "OpenAI (ChatGPT)", purpose: "검색 · 답변 · AI 학습" },
  Anthropic: { name: "Anthropic (Claude)", purpose: "답변 · AI 학습" },
  Perplexity: { name: "Perplexity", purpose: "검색 · 답변" },
  Meta: { name: "Meta (페이스북 · 인스타그램)", purpose: "AI 학습용" },
  ByteDance: { name: "ByteDance (틱톡)", purpose: "AI 학습용" },
  Apple: { name: "Apple", purpose: "AI 학습용" },
  Google: { name: "Google", purpose: "AI 학습용" },
  Microsoft: { name: "Microsoft", purpose: "AI" },
  Naver: { name: "Naver", purpose: "AI" },
  Amazon: { name: "Amazon", purpose: "AI 학습 · 알렉사" },
  "Common Crawl": { name: "Common Crawl", purpose: "공개 자료 모음 (여러 AI가 학습에 씀)" }
};

const UNKNOWN_COMPANY = "기타";

/** 로봇 이름으로 회사 찾기 — 홈페이지 분류 목록에 없는 이름도 허브가 아는 것은 옮긴다 */
const BOT_NAME_COMPANY: [RegExp, string][] = [
  [/meta-external|facebookbot|meta-webindexer/i, "Meta"],
  [/gptbot|chatgpt|oai-searchbot/i, "OpenAI"],
  [/claude|anthropic/i, "Anthropic"],
  [/perplexity/i, "Perplexity"],
  [/bytespider|tiktok/i, "ByteDance"],
  [/applebot/i, "Apple"],
  [/google-extended|googleother|google-cloudvertexbot/i, "Google"],
  [/amazonbot/i, "Amazon"],
  [/ccbot/i, "Common Crawl"]
];

export function companyOfBotName(name: string): string | null {
  for (const [re, company] of BOT_NAME_COMPANY) if (re.test(name)) return company;
  return null;
}

export type CompanyRow = {
  key: string;
  name: string;
  purpose: string;
  value: number;
  change: DeltaView | null;
  /** 회사를 알 수 없는 줄 — 들어 있는 로봇 이름(알면) */
  names?: string[];
  unknown?: boolean;
};

function addPair(into: Map<string, BotsCountPair>, key: string, pair: BotsCountPair) {
  const prev = into.get(key);
  if (!prev) {
    into.set(key, { current: pair.current, previous: pair.previous });
    return;
  }
  into.set(key, {
    current: prev.current + pair.current,
    previous: prev.previous == null || pair.previous == null ? null : prev.previous + pair.previous
  });
}

/** 홈페이지가 이름별 숫자를 주면(ai.byName) 쓴다. 지금 응답에는 없다 */
function byNameOf(payload: BotsStatsPayload): Record<string, BotsCountPair> | null {
  const value = payload.ai.byName;
  return value && typeof value === "object" ? value : null;
}

/** 회사별 줄 — 많은 순, 0 인 회사는 뺀다. 회사를 알 수 없는 로봇은 맨 끝 */
export function companyRows(payload: BotsStatsPayload | null): CompanyRow[] {
  if (!payload) return [];
  const companies = new Map<string, BotsCountPair>();
  const unknownNames: string[] = [];
  const byName = byNameOf(payload);
  if (byName) {
    for (const [name, pair] of Object.entries(byName)) {
      const company = companyOfBotName(name);
      if (company) addPair(companies, company, pair);
      else {
        addPair(companies, UNKNOWN_COMPANY, pair);
        if (pair.current > 0) unknownNames.push(name);
      }
    }
  } else {
    for (const [key, pair] of Object.entries(payload.ai.byCompany ?? {})) addPair(companies, key, pair);
  }
  const rows: CompanyRow[] = [];
  for (const [key, pair] of companies) {
    if (!(pair.current > 0)) continue;
    const unknown = key === UNKNOWN_COMPANY;
    const info = AI_COMPANY_INFO[key];
    rows.push({
      key,
      name: unknown ? "회사를 알 수 없는 로봇" : (info?.name ?? key),
      purpose: unknown
        ? unknownNames.length > 0
          ? `이름: ${unknownNames.join(", ")}`
          : "홈페이지 분류 목록에 없는 로봇 (이름은 아직 받지 못함)"
        : (info?.purpose ?? "AI"),
      value: pair.current,
      change: botsDelta(pair),
      names: unknown ? unknownNames : undefined,
      unknown: unknown || undefined
    });
  }
  return rows.sort((a, b) => Number(a.unknown ?? false) - Number(b.unknown ?? false) || b.value - a.value);
}

/** 검색 엔진 로봇 이름 → 화면 이름 (AI 가 아니다) */
const SEARCH_ENGINE_INFO: Record<string, { name: string; purpose: string }> = {
  Googlebot: { name: "Google", purpose: "검색" },
  Bingbot: { name: "Microsoft Bing", purpose: "검색" },
  Yeti: { name: "Naver", purpose: "검색" },
  Applebot: { name: "Apple", purpose: "검색 (Siri · Spotlight)" }
};

export function searchEngineRows(payload: BotsStatsPayload | null): CompanyRow[] {
  if (!payload) return [];
  return Object.entries(payload.searchEngines.byName ?? {})
    .filter(([, pair]) => pair.current > 0)
    .map(([name, pair]) => ({
      key: name,
      name: SEARCH_ENGINE_INFO[name]?.name ?? name,
      purpose: SEARCH_ENGINE_INFO[name]?.purpose ?? "검색",
      value: pair.current,
      change: botsDelta(pair)
    }))
    .sort((a, b) => b.value - a.value);
}

/** 사이트 안쪽 주소(이미지 변환 · API) — 콘텐츠가 아니라 목록에서 뺀다. robots.txt · llms.txt · sitemap.xml 은 남긴다 */
export function isInternalPath(path: string): boolean {
  return /^\/(_next|api)(\/|$)/.test(path);
}

/**
 * 많이 읽어 간 콘텐츠 — 홈페이지는 많이 읽힌 주소 10개만 준다.
 * 그중 이미지 변환 주소(/_next) 등을 빼면 줄이 적어질 수 있어, 뺀 개수를 함께 돌려준다.
 */
export function readTopInfo(payload: BotsStatsPayload | null, titles: TitleMap, limit = 5) {
  const { rows, llms } = buildAiTopContents(payload, titles);
  const all = llms.count != null && llms.count > 0 ? [...rows, { ...llms, fixed: undefined }] : rows;
  const internal = (payload?.ai.topPaths ?? []).filter((row) => isInternalPath(row.path)).length;
  return {
    rows: all
      .filter((row) => !isInternalPath(row.path))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, limit),
    listed: payload?.ai.topPaths?.length ?? 0,
    internal
  };
}

export function readTop(payload: BotsStatsPayload | null, titles: TitleMap, limit = 5) {
  return readTopInfo(payload, titles, limit).rows;
}

/* ─────────────────────── ② 답에 나오나 ─────────────────────── */

/** 홈페이지 서비스 이름 → 화면 이름. 「구글 AI 개요」는 구글 검색 결과 위 AI 요약 칸이다(제미나이 앱 아님) */
export const GOOGLE_SUMMARY = "구글 검색 AI 요약";
export const ANSWER_LABEL: Record<string, string> = { "구글 AI 개요": GOOGLE_SUMMARY };

export function answerLabel(label: string): string {
  return ANSWER_LABEL[label] ?? label;
}

/** 늘 보이는 열 — 확인한 서비스를 앞에 두고, 확인 안 한 서비스도 「확인 안 함」으로 보인다 */
export const ANSWER_COLUMNS_DEFAULT = ["ChatGPT", GOOGLE_SUMMARY, "Perplexity", "Claude", "네이버"] as const;

export function answerColumns(recorded: string[] = []): string[] {
  const cols: string[] = [];
  for (const name of [...recorded.map(answerLabel), ...ANSWER_COLUMNS_DEFAULT]) {
    if (!cols.includes(name)) cols.push(name);
  }
  return cols.slice(0, 5);
}

/* ─────────────────────── ③ 사람이 왔나 ─────────────────────── */

const VISIT_BARS = ["ChatGPT", "Perplexity", "Claude", "Gemini"] as const;

/** 네 칸. 그 밖 서비스(Copilot 등)에서 온 방문이 있으면 「그 밖」 한 칸을 더해 합이 맞게 한다 */
export function visitBars(visits: AiVisits | null): HBarRow[] {
  const sessionsOf = (list: { name: string; sessions: number }[] | undefined, pick: (name: string) => boolean) =>
    (list ?? []).filter((row) => pick(row.name)).reduce((acc, row) => acc + row.sessions, 0);
  const named = new Set<string>(VISIT_BARS);
  const row = (name: string, pick: (n: string) => boolean): HBarRow => {
    const current = sessionsOf(visits?.current.by_name, pick);
    const previous = visits?.previous ? sessionsOf(visits.previous.by_name, pick) : null;
    return { name, value: current, change: visits ? makeCountDelta(current, previous, true, unit(previous)) : null };
  };
  const rows = VISIT_BARS.map((name) => row(name, (n) => n === name));
  const rest = row("그 밖", (n) => !named.has(n));
  if ((rest.value ?? 0) > 0) rows.push(rest);
  return rows;
}

/** 도착한 콘텐츠 — buildAiVisitPages 그대로. GA 가 들어온 페이지를 못 남긴 줄((not set))만 말로 바꾼다 */
export function visitPages(visits: AiVisits | null, titles: TitleMap): (AiVisitPageRow & { unknown?: true })[] {
  return buildAiVisitPages(visits, titles).map((row) =>
    row.path === "(not set)" ? { ...row, title: "들어온 페이지 모름", unknown: true } : row
  );
}

export function visitSummary(bundle: StatsBundle | null) {
  return aiVisitsSummary(bundle, unit);
}

/* ─────────────────────── 맨 위 답 문장 ─────────────────────── */

/** 「AI 답변을 보고 <em>N회 방문</em>했어요. …」 */
export function aiAnswer(bundle: StatsBundle | null): { lead: string; em: string; tail: string } | null {
  const visits = readAiVisits(bundle);
  if (!visits) return null;
  return {
    lead: "AI 답변을 보고 ",
    em: `${visits.current.total.toLocaleString("ko-KR")}회 방문`,
    tail: "했어요. AI가 읽어 간 것과 답변에 나온 것은 아래에서 따로 봐요."
  };
}
