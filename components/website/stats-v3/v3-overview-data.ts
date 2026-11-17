/**
 * 요약 화면 v3 — 카드 다섯 칸은 지금 요약 화면의 buildSummaryCards, 추이는 buildTrend 를 그대로 쓴다.
 * 여기서 새로 정하는 것은 맨 위 답 문장(숫자로 채우는 틀)뿐이다.
 */

import { byDate, type DeltaView } from "@/components/website/stats/stats-data";
import { buildSummaryCards, buildTrend } from "@/components/website/stats/summary-data";
import type { SummaryCardId } from "@/components/website/stats/stats-labels";
import { ga4, prevGuard, searchToArticleOf, visitsOf } from "@/components/website/stats-v3/v3-data";
import type { StatsBundle } from "@/lib/website/stats";

export type OverviewCard = {
  id: SummaryCardId;
  value: string | null;
  delta: DeltaView;
};

/** 카드 다섯 칸. 응답에 값이 없는 칸(AI · 문의하기 누름이 옛 응답일 때)은 빠진다 — 화면이 「준비 중」으로 둔다 */
export function overviewCards(bundle: StatsBundle | null): Map<SummaryCardId, OverviewCard> {
  return new Map(
    buildSummaryCards(bundle).map((card) => [
      card.id,
      { id: card.id, value: card.value, delta: { delta: card.delta, tone: card.tone, previous: card.previous } }
    ])
  );
}

/** 방문자 추이 — buildTrend 값 + 세로선을 그을 날짜(같은 걸러 냄으로 정렬한 이번 기간 날짜) */
export function overviewTrend(bundle: StatsBundle | null): {
  dates: string[];
  current: number[];
  previous: (number | null)[];
} {
  const rows = buildTrend(bundle);
  const dates = [...ga4(bundle, "daily", "current")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate)
    .map((row) => row.date);
  return {
    dates,
    current: rows.map((row) => row.current as number),
    previous: rows.map((row) => (typeof row.previous === "number" ? row.previous : null))
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
  if (visits.current == null) lead = "방문자 숫자가 아직 없고, ";
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
