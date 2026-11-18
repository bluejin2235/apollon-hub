import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { briefLines, overviewAnswer, overviewCards, overviewTrend } from "../../components/website/stats-v3/v3-overview-data";
import { PERIOD_USERS_MISSING_NOTE } from "../../components/website/stats/stats-labels";
import { buildSummaryBriefFacts } from "../../components/website/stats/summary-data";
import type { StatsBundle, StatsPoint } from "../../lib/website/stats";

function ga(kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source: "ga4", kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function bundleOf(opts: { current: number; previous: number; oldSite?: boolean; rate?: [number, number] }): StatsBundle {
  const [cur, prev] = opts.rate ?? [0.68, 0.32];
  const landing = (when: number) => [
    ga("landing_channel", "", { key: "/works/a", key2: "Organic Search", sessions: Math.round(when * 100) }),
    ga("landing_channel", "", { key: "/", key2: "Organic Search", sessions: 100 - Math.round(when * 100) })
  ];
  return {
    daily: {
      kind: "daily",
      actual_from: "2026-11-12",
      actual_to: "2026-11-13",
      prev_from: "2026-11-10",
      prev_to: "2026-11-11",
      prev_includes_pre_launch: opts.oldSite ?? false,
      launch_date: "2026-11-11",
      period_users: {
        current: opts.current,
        previous: opts.previous,
        current_new: null,
        previous_new: null,
        current_summed: false,
        previous_summed: false
      },
      current: [ga("daily", "2026-11-13", { users: 40 }), ga("daily", "2026-11-12", { users: 50 })],
      previous: [ga("daily", "2026-11-10", { users: 30 }), ga("daily", "2026-11-11", { users: 35 })],
      overall: []
    },
    landing_channel: {
      kind: "landing_channel",
      current: landing(cur),
      previous: landing(prev),
      overall: []
    }
  } as unknown as StatsBundle;
}

describe("v3 요약 답 문장", () => {
  it("늘어난 % 와 %p", () => {
    assert.deepEqual(overviewAnswer(bundleOf({ current: 84, previous: 76 })), {
      lead: "방문자는 11% 늘었고, ",
      em: "검색에서 글로 바로 오는 비율은 36%p 올랐어요."
    });
  });

  it("5% 안쪽은 비슷했고", () => {
    assert.equal(overviewAnswer(bundleOf({ current: 100, previous: 98 }))?.lead, "방문자는 앞 기간과 비슷했고, ");
  });

  it("앞 기간이 옛 사이트면 앞 기간 없이", () => {
    assert.deepEqual(overviewAnswer(bundleOf({ current: 174, previous: 84, oldSite: true })), {
      lead: "방문자는 174명이었고, ",
      em: "검색에서 글로 바로 오는 비율은 68%예요."
    });
  });
});

describe("v3 요약 카드 · 추이", () => {
  it("카드 값은 지금 요약 카드 그대로", () => {
    const cards = overviewCards(bundleOf({ current: 84, previous: 76 }));
    assert.equal(cards.get("visit")?.value, "84");
    assert.equal(cards.get("visit")?.delta.delta, "▲ 11%");
    assert.equal(cards.get("visit")?.delta.previous, "76명");
    assert.equal(cards.get("searchToArticle")?.value, "68");
    assert.equal(cards.has("ai"), false);
  });

  it("기간 전체 방문자를 못 받으면 날짜별 합(90명)으로 대신하지 않고 「—」와 알림", () => {
    const bundle = bundleOf({ current: 84, previous: 76 });
    const missing = { ...bundle, daily: { ...bundle.daily, period_users: undefined } } as unknown as StatsBundle;
    const card = overviewCards(missing).get("visit");
    assert.equal(card?.value, null);
    assert.equal(card?.delta.delta, null);
    assert.equal(card?.hint, PERIOD_USERS_MISSING_NOTE);
    assert.equal(overviewCards(bundle).get("visit")?.hint, null);
    assert.equal(overviewAnswer(missing)?.lead, "이번에는 기간 방문자 수를 세지 못했고, ");
    const facts = buildSummaryBriefFacts(missing, "2026-11-12", "2026-11-13");
    assert.equal(facts?.visitsBasis, "missing");
    assert.deepEqual(facts?.visits, { current: null, previous: null });
  });

  it("추이 날짜는 값과 같은 순서", () => {
    assert.deepEqual(overviewTrend(bundleOf({ current: 84, previous: 76 })), {
      dates: ["2026-11-12", "2026-11-13"],
      current: [50, 40],
      previous: [30, 35]
    });
  });
});

describe("v3 루나 요약 줄", () => {
  it("문장마다 한 줄, 소수점은 자르지 않는다", () => {
    assert.deepEqual(briefLines("방문자는 174명이었어요. 한 번에 2.3개를 봤어요!  검색은 아직 적어요."), [
      "방문자는 174명이었어요.",
      "한 번에 2.3개를 봤어요!",
      "검색은 아직 적어요."
    ]);
  });
});
