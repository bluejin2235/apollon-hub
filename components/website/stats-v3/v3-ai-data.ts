/**
 * AI 화면 v3 — 세 질문
 *   ① AI가 우리 사이트를 읽어 갔나 (kind=bots, 로봇 기록은 2026-11-16 부터)
 *   ② AI 답변에 우리가 나오나 (stats/ai-answers, 사람이 직접 물어본 기록)
 *   ③ AI 답변을 보고 사람이 왔나 (kind=ai_visits, GA 출처가 AI 서비스인 방문)
 *
 * ① 은 홈페이지가 나눈 회사(ai.byCompany)를 그대로 쓴다. 표와 날짜별 그래프가 같은 출처라 숫자가 어긋나지 않는다.
 * 허브는 회사를 다시 나누지 않는다. 검색 엔진 로봇(구글 · 빙 · 네이버)은 AI 가 아니어서 따로 「참고」로 보인다.
 * 홈페이지가 회사를 정하지 못한 로봇(CCBot 포함)은 「기타 로봇」 한 줄이고, 이름별 숫자(ai.byName)가 오면 이름을 적는다.
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

/** 홈페이지 회사 이름 → 화면 이름. 회사 나누기는 홈페이지(ai.byCompany)가 한 그대로 쓴다 */
export const AI_COMPANY_INFO: Record<string, { name: string }> = {
  OpenAI: { name: "OpenAI (ChatGPT)" },
  Anthropic: { name: "Anthropic (Claude)" },
  Perplexity: { name: "Perplexity" },
  Meta: { name: "Meta (페이스북 · 인스타그램)" },
  ByteDance: { name: "ByteDance (틱톡)" },
  Apple: { name: "Apple" },
  Google: { name: "Google" },
  Microsoft: { name: "Microsoft" },
  Naver: { name: "Naver" }
};

/** 홈페이지가 회사를 정하지 못한 로봇을 모으는 칸 */
export const OTHER_COMPANY = "기타";
export const OTHER_COMPANY_NAME = "기타 로봇 (회사 분류 없음)";

/** 회사 이름 — 표와 그래프가 같은 이름을 쓴다. short 는 그래프 범례용(괄호 뺌) */
export function companyLabel(key: string, short = false): string {
  if (key === OTHER_COMPANY) return short ? "기타 로봇" : OTHER_COMPANY_NAME;
  const name = AI_COMPANY_INFO[key]?.name ?? key;
  return short ? name.replace(/ \(.*\)$/, "") : name;
}

/**
 * 홈페이지 로봇 분류 규칙(apollon-website src/lib/stats/bot-class.ts BOT_CLASS_RULES)을 옮겨 둔 것.
 * 회사를 새로 정하는 데 쓰지 않는다. 홈페이지가 이름별 숫자(ai.byName)를 주면 그 로봇이 무엇에 쓰는 로봇인지 적는 데만 쓴다.
 * 홈페이지 규칙이 바뀌면 여기도 같이 바꾼다. 긴 이름부터 맞춘다.
 */
export const HOMEPAGE_BOT_RULES: readonly { token: string; company: string; purpose: string }[] = [
  { token: "chatgpt-user", company: "OpenAI", purpose: "물어봐서 읽음" },
  { token: "claude-user", company: "Anthropic", purpose: "물어봐서 읽음" },
  { token: "perplexity-user", company: "Perplexity", purpose: "물어봐서 읽음" },
  { token: "oai-searchbot", company: "OpenAI", purpose: "검색" },
  { token: "claude-searchbot", company: "Anthropic", purpose: "검색" },
  { token: "perplexitybot", company: "Perplexity", purpose: "검색" },
  { token: "gptbot", company: "OpenAI", purpose: "학습" },
  { token: "claudebot", company: "Anthropic", purpose: "학습" },
  { token: "bytespider", company: "ByteDance", purpose: "학습" },
  { token: "meta-externalagent", company: "Meta", purpose: "학습" },
  { token: "meta-externalfetcher", company: "Meta", purpose: "물어봐서 읽음" },
  { token: "applebot-extended", company: "Apple", purpose: "학습" },
  { token: "ccbot", company: OTHER_COMPANY, purpose: "학습" }
];

/** 쓰임을 늘 같은 순서로 */
const PURPOSE_ORDER = ["물어봐서 읽음", "검색", "학습", "기타"];

const RULES_BY_LENGTH = [...HOMEPAGE_BOT_RULES].sort((a, b) => b.token.length - a.token.length);

/** 로봇 이름 → 홈페이지 규칙의 회사 · 쓰임. 규칙에 없으면 기타 · 기타 (홈페이지와 같다) */
export function classifyBotName(name: string): { company: string; purpose: string } {
  const value = name.toLowerCase();
  const rule = RULES_BY_LENGTH.find((item) => value.includes(item.token));
  return rule ? { company: rule.company, purpose: rule.purpose } : { company: OTHER_COMPANY, purpose: "기타" };
}

/** 이 회사로 분류되는 로봇들의 쓰임(규칙 기준) — 이름별 숫자가 없을 때 「이 회사 로봇 종류」로만 보인다 */
function rulePurposes(company: string): string[] {
  const set = new Set(HOMEPAGE_BOT_RULES.filter((rule) => rule.company === company).map((rule) => rule.purpose));
  return PURPOSE_ORDER.filter((purpose) => set.has(purpose));
}

export type CompanyRow = {
  key: string;
  name: string;
  purpose: string;
  value: number;
  change: DeltaView | null;
  /** 이 줄에 실제로 들어 있는 로봇 이름(홈페이지가 이름별 숫자를 줄 때만) */
  names?: string[];
  unknown?: boolean;
};

/** 홈페이지가 이름별 숫자를 주면(ai.byName) 쓴다. 지금 응답에는 없다 */
function byNameOf(payload: BotsStatsPayload): Record<string, BotsCountPair> | null {
  const value = payload.ai.byName;
  return value && typeof value === "object" ? value : null;
}

/**
 * 회사별 줄 — 숫자와 회사 나누기는 늘 홈페이지 ai.byCompany 하나만 쓴다(날짜별 그래프와 같은 출처).
 * 쓰임 글은 그 줄에 실제로 들어온 로봇에서 만든다. 한 회사 줄에 쓰임이 섞이면 「학습 · 물어봐서 읽음」처럼 다 적는다.
 * 이름별 숫자가 없으면 실제로 어느 로봇이 왔는지 몰라, 그 회사 로봇 종류를 「로봇 종류:」로 적는다.
 * 많은 순, 0 인 회사는 뺀다. 기타 로봇은 맨 끝.
 */
export function companyRows(payload: BotsStatsPayload | null): CompanyRow[] {
  if (!payload) return [];
  const byName = byNameOf(payload);
  const seen = new Map<string, { purposes: Set<string>; names: string[] }>();
  if (byName) {
    for (const [name, pair] of Object.entries(byName)) {
      if (!(pair.current > 0)) continue;
      const cls = classifyBotName(name);
      const item = seen.get(cls.company) ?? { purposes: new Set<string>(), names: [] };
      item.purposes.add(cls.purpose);
      item.names.push(name);
      seen.set(cls.company, item);
    }
  }
  const rows: CompanyRow[] = [];
  for (const [key, pair] of Object.entries(payload.ai.byCompany ?? {})) {
    if (!(pair.current > 0)) continue;
    const unknown = key === OTHER_COMPANY;
    const found = byName ? seen.get(key) : undefined;
    let purpose: string;
    if (found) {
      const purposes = PURPOSE_ORDER.filter((item) => found.purposes.has(item) && item !== "기타");
      // 기타 칸은 회사를 모르니 로봇 이름을 그대로 보인다(CCBot 등)
      purpose = unknown
        ? `이름: ${found.names.join(", ")}`
        : purposes.length > 0
          ? purposes.join(" · ")
          : "쓰임 모름";
    } else if (unknown) {
      purpose = "홈페이지 분류 목록에 없는 로봇과 CCBot (로봇 이름은 아직 받지 못함)";
    } else {
      const purposes = rulePurposes(key);
      purpose = purposes.length > 0 ? `로봇 종류: ${purposes.join(" · ")}` : "쓰임 모름";
    }
    rows.push({
      key,
      name: companyLabel(key),
      purpose,
      value: pair.current,
      change: botsDelta(pair),
      names: found?.names,
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
