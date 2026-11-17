/**
 * AI 화면 v3 — 「AI가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?」
 *
 * ① 읽어 감은 지금 AI 화면의 readBotsPayload · countDelta · buildAiTopContents,
 * ③ 사람이 옴은 readAiVisits · aiVisitsSummary · buildAiVisitPages 를 그대로 쓴다.
 * 여기서 정하는 것은 막대 이름과 순서뿐이다.
 *   · ① 구글 막대는 뺀다(팀장 결정) — 구글 로봇은 AI 와 검색을 구분할 수 없다
 *   · ③ 목업 네 칸(ChatGPT · Perplexity · Claude · Gemini) + 그 밖 서비스가 있으면 「그 밖」 한 칸
 * ② 답에 씀은 기록 표가 아직 없어 화면이 「준비 중」으로 둔다.
 */

import {
  aiVisitsSummary,
  buildAiTopContents,
  countDelta,
  readAiVisits,
  readBotsPayload,
  type AiVisits,
  type BotsCountPair,
  type BotsStatsPayload
} from "@/components/website/stats/ai-data";
import type { TitleMap } from "@/components/website/stats/content-data";
import { intText, makeCountDelta, type DeltaView } from "@/components/website/stats/stats-data";
import type { HBarRow } from "@/components/website/stats-v3/v3-parts";
import type { StatsBundle } from "@/lib/website/stats";

export { botsPeriodBeforeSince, buildAiVisitPages, readAiVisits, readBotsPayload } from "@/components/website/stats/ai-data";

const unit = (value: number | null) => (value == null ? null : `${intText(value)}회`);

/** 개수 증감 + 「앞 기간 N회」 */
export function botsDelta(pair: BotsCountPair | undefined, higherIsBetter = true): DeltaView {
  const view = countDelta(pair, higherIsBetter);
  return view.previous == null ? view : { ...view, previous: `${view.previous}회` };
}

/* ─────────────────────── ① 읽어 감 ─────────────────────── */

/** 화면 이름 → 홈페이지 회사 이름. 「기타」는 나머지 전부(구글 제외) */
const READ_BARS: { name: string; company: string | null }[] = [
  { name: "ChatGPT", company: "OpenAI" },
  { name: "Claude", company: "Anthropic" },
  { name: "Perplexity", company: "Perplexity" },
  { name: "기타", company: null }
];

const NAMED_COMPANIES = new Set(["OpenAI", "Anthropic", "Perplexity", "Google"]);

function sumPairs(pairs: BotsCountPair[]): BotsCountPair {
  const current = pairs.reduce((acc, pair) => acc + (typeof pair.current === "number" ? pair.current : 0), 0);
  const previous = pairs.length > 0 && pairs.every((pair) => typeof pair.previous === "number")
    ? pairs.reduce((acc, pair) => acc + (pair.previous as number), 0)
    : null;
  return { current, previous };
}

/** 회사별 막대 — 값이 0 이어도 네 칸. 막대마다 증감 */
export function readBars(payload: BotsStatsPayload | null): HBarRow[] {
  const byCompany = payload?.ai.byCompany ?? {};
  return READ_BARS.map(({ name, company }) => {
    const pairs = Object.entries(byCompany)
      .filter(([key]) => (company ? key === company : !NAMED_COMPANIES.has(key)))
      .map(([, pair]) => pair);
    const pair = sumPairs(pairs);
    return { name, value: pair.current, change: payload ? botsDelta(pair) : null };
  });
}

/** 많이 읽어 간 콘텐츠 — 목업처럼 다섯 줄. llms.txt 는 목록에서 빠진다(buildAiTopContents) */
export function readTop(payload: BotsStatsPayload | null, titles: TitleMap, limit = 5) {
  return buildAiTopContents(payload, titles).rows.slice(0, limit);
}

/* ─────────────────────── ③ 사람이 옴 ─────────────────────── */

const VISIT_BARS = ["ChatGPT", "Perplexity", "Claude", "Gemini"] as const;

/** 목업 네 칸. 그 밖 서비스(Copilot 등)에서 온 방문이 있으면 「그 밖」 한 칸을 더해 합이 맞게 한다 */
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

export function visitSummary(bundle: StatsBundle | null) {
  return aiVisitsSummary(bundle, unit);
}

/* ─────────────────────── 맨 위 답 문장 ─────────────────────── */

/** 「AI에서 <em>N회 방문</em>했고, 읽기와 인용은 따로 확인해야 해요.」 */
export function aiAnswer(bundle: StatsBundle | null): { lead: string; em: string; tail: string } | null {
  const visits = readAiVisits(bundle);
  if (!visits) return null;
  const tail = "했고, 읽기와 인용은 따로 확인해야 해요.";
  return { lead: "AI에서 ", em: `${visits.current.total.toLocaleString("ko-KR")}회 방문`, tail };
}
