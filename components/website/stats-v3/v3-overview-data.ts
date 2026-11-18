/**
 * 요약 화면 v3 — 카드 다섯 칸은 지금 요약 화면의 buildSummaryCards, 추이 이번 기간 값은 buildTrend 와 같다(앞 기간은 날짜로 찾는다).
 * 여기서 새로 정하는 것은 맨 위 답 문장(숫자로 채우는 틀)뿐이다.
 */

import { byDate, type DeltaView } from "@/components/website/stats/stats-data";
import { buildSummaryCards } from "@/components/website/stats/summary-data";
import type { SummaryCardId } from "@/components/website/stats/stats-labels";
import { ga4, prevGuard, previousByDate, searchToArticleOf, visitsOf } from "@/components/website/stats-v3/v3-data";
import type { StatsBundle } from "@/lib/website/stats";

export type OverviewCard = {
  id: SummaryCardId;
  value: string | null;
  delta: DeltaView;
  /** 칸 아래 짧은 알림. 지금은 방문자 칸에서 기간 방문자 수를 못 받았을 때만 쓴다 */
  hint?: string | null;
};

/** 카드 다섯 칸. 응답에 값이 없는 칸(AI · 문의하기 누름이 옛 응답일 때)은 빠진다 — 화면이 「준비 중」으로 둔다 */
export function overviewCards(bundle: StatsBundle | null): Map<SummaryCardId, OverviewCard> {
  return new Map(
    buildSummaryCards(bundle).map((card) => [
      card.id,
      {
        id: card.id,
        value: card.value,
        delta: { delta: card.delta, tone: card.tone, previous: card.previous },
        hint: card.id === "visit" ? (card.sub ?? null) : null
      }
    ])
  );
}

/**
 * 방문자 추이 — 이번 기간은 buildTrend 와 같은 값. 앞 기간은 순번이 아니라 비교 날짜(prevDateOf)로 찾는다.
 * 앞 기간에 그 날 행이 없으면 null. 그래프는 끊기고 상자는 「앞 기간 기록 없음」.
 */
export function overviewTrend(bundle: StatsBundle | null): {
  dates: string[];
  current: number[];
  previous: (number | null)[];
} {
  const rows = (when: "current" | "previous") =>
    [...ga4(bundle, "daily", when)].filter((row) => typeof row.users === "number").sort(byDate);
  const current = rows("current");
  const dates = current.map((row) => row.date);
  const previous = new Map(rows("previous").map((row) => [row.date, row.users as number]));
  return {
    dates,
    current: current.map((row) => row.users as number),
    previous: previousByDate(bundle, dates, previous)
  };
}

/**
 * 답 문장 — 「방문자는 …고, <em>검색에서 글로 바로 오는 비율은 …</em>」.
 * 숫자는 카드와 같은 값(방문자 · 검색→글 비율)이고, 앞 기간이 옛 사이트면 앞 기간 없이 쓴다.
 */
export function overviewAnswer(bundle: StatsBundle | null): { lead: string; em: string } | null {
  if (!bundle) return null;
  const prev = prevGuard(bundle);
  const visits = visitsOf(bundle);
  const visitPrev = prev(visits.previous);

  let lead: string;
  if (visits.periodMissing) lead = "이번에는 기간 방문자 수를 세지 못했고, ";
  else if (visits.current == null) lead = "방문자 숫자가 아직 없고, ";
  else if (visitPrev == null || visitPrev === 0) lead = `방문자는 ${visits.current.toLocaleString("ko-KR")}명이었고, `;
  else {
    const rate = (visits.current - visitPrev) / visitPrev;
    const size = Math.round(Math.abs(rate) * 100);
    lead =
      size < 5 ? "방문자는 앞 기간과 비슷했고, " : `방문자는 ${size}% ${rate > 0 ? "늘었고" : "줄었고"}, `;
  }

  const rate = searchToArticleOf(bundle, "current");
  const ratePrev = prev(searchToArticleOf(bundle, "previous"));
  let em: string;
  if (rate == null) em = "검색으로 온 방문은 아직 없어요.";
  else {
    const pct = Math.round(rate * 100);
    if (ratePrev == null) em = `검색에서 글로 바로 오는 비율은 ${pct}%예요.`;
    else {
      const diff = Math.round((rate - ratePrev) * 100);
      em =
        diff === 0
          ? `검색에서 글로 바로 오는 비율은 ${pct}%로 그대로예요.`
          : `검색에서 글로 바로 오는 비율은 ${Math.abs(diff)}%p ${diff > 0 ? "올랐어요" : "내렸어요"}.`;
    }
  }
  return { lead, em };
}

/** 루나 요약 문단 → 목업의 번호 붙은 줄. 문장 끝(. ! ?) 뒤 빈칸에서만 자른다(「2.3개」 같은 소수는 그대로) */
export function briefLines(summary: string): string[] {
  return summary
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
