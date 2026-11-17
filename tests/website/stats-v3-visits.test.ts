import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { buildDepthTrend, buildDwellTrend } from "../../components/website/stats/behavior-data";
import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import {
  countryBars,
  depthTrend,
  deviceBars,
  dwellTrend,
  landingTop,
  newReturningBars,
  outcomes,
  visitCards,
  visitsAnswer
} from "../../components/website/stats-v3/v3-visits-data";
import type { StatsBundle, StatsPoint } from "../../lib/website/stats";

function ga(kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source: "ga4", kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function bundleOf(oldSite = false): StatsBundle {
  const base = {
    actual_from: "2026-11-12",
    actual_to: "2026-11-13",
    prev_from: "2026-11-10",
    prev_to: "2026-11-11",
    prev_includes_pre_launch: oldSite,
    launch_date: "2026-11-11",
    overall: [],
    period_users: {
      current: 80,
      previous: 60,
      current_new: 64,
      previous_new: 50,
      current_summed: false,
      previous_summed: false
    },
    lets_talk_click: { current: 3, previous: 2, delta: 1, delta_pct: null },
    generate_lead: { current: 1, previous: 0, delta: 1, delta_pct: null }
  };
  const r = (kind: string, current: StatsPoint[], previous: StatsPoint[]) => ({ ...base, kind, current, previous });
  return {
    daily: r(
      "daily",
      [
        ga("daily", "2026-11-12", { users: 50, sessions: 60, views: 120, avg_seconds: 70 }),
        ga("daily", "2026-11-13", { users: 40, sessions: 40, views: 110, avg_seconds: 100 })
      ],
      [
        ga("daily", "2026-11-10", { users: 30, sessions: 40, views: 80, avg_seconds: 60 }),
        ga("daily", "2026-11-11", { users: 35, sessions: 40, views: 80, avg_seconds: 60 })
      ]
    ),
    landing: r(
      "landing",
      [
        ga("landing", "2026-11-12", { key: "/", sessions: 30 }),
        ga("landing", "2026-11-13", { key: "/", sessions: 20 }),
        ga("landing", "2026-11-12", { key: "/works/a", sessions: 12 }),
        ga("landing", "2026-11-13", { key: "/en/about", sessions: 3 })
      ],
      [ga("landing", "2026-11-10", { key: "/", sessions: 40 })]
    ),
    device: r(
      "device",
      [
        ga("device", "2026-11-12", { key: "mobile", users: 30 }),
        ga("device", "2026-11-12", { key: "desktop", users: 20 })
      ],
      [ga("device", "2026-11-10", { key: "mobile", users: 20 })]
    ),
    country: r(
      "country",
      [
        ga("country", "2026-11-12", { key: "South Korea", users: 40 }),
        ga("country", "2026-11-12", { key: "kor", users: 2 }),
        ga("country", "2026-11-12", { key: "United States", users: 5 }),
        ga("country", "2026-11-12", { key: "Japan", users: 3 }),
        ga("country", "2026-11-12", { key: "France", users: 1 }),
        ga("country", "2026-11-12", { key: "Germany", users: 1 })
      ],
      [ga("country", "2026-11-10", { key: "South Korea", users: 30 })]
    ),
    event: r(
      "event",
      [ga("event", "2026-11-12", { key: "newsletter_signup", events: 2 })],
      [ga("event", "2026-11-10", { key: "page_view", events: 50 })]
    )
  } as unknown as StatsBundle;
}

describe("v3 방문 패턴 카드", () => {
  it("방문자(기간 전체) · 방문 횟수 · 한 번에 본 페이지 수 · 머문 시간 · 글로 바로", () => {
    const cards = new Map(visitCards(bundleOf()).map((card) => [card.id, card]));
    assert.equal(cards.get("visitors")?.value, "80");
    assert.equal(cards.get("visitors")?.delta.previous, "60명");
    assert.equal(cards.get("sessions")?.value, "100");
    assert.equal(cards.get("depth")?.value, "2.3");
    assert.equal(cards.get("dwell")?.value, "1분 22");
    assert.equal(cards.get("entries")?.value, "12");
  });

  it("앞 기간이 옛 사이트면 증감 없음", () => {
    for (const card of visitCards(bundleOf(true))) assert.equal(card.delta.delta, null);
  });

  it("추이는 지금 행동 화면 buildDepthTrend · buildDwellTrend 와 같은 값", () => {
    const depth = depthTrend(bundleOf());
    assert.deepEqual(depth.current, buildDepthTrend(bundleOf()).map((row) => row.pages));
    assert.deepEqual(depth.previous, buildDepthTrend(bundleOf()).map((row) => row.previous));
    const dwell = dwellTrend(bundleOf());
    assert.deepEqual(dwell.current, buildDwellTrend(bundleOf()).map((row) => row.seconds));
    assert.deepEqual(dwell.previous, buildDwellTrend(bundleOf()).map((row) => row.previous));
  });
});

describe("v3 방문 패턴 목록 · 막대 · 성과", () => {
  it("들어온 페이지 상위 — 경로별 합, 국영", () => {
    assert.deepEqual(
      landingTop(bundleOf(), EMPTY_TITLES).map((row) => [row.title, row.sessions, row.lang]),
      [
        ["홈", 50, "ko"],
        ["작품 a".replace("작품 ", ""), 12, "ko"],
        ["About", 3, "en"]
      ]
    );
  });

  it("처음 / 다시 = 새 방문자 / 나머지", () => {
    assert.deepEqual(
      newReturningBars(bundleOf())?.map((bar) => [bar.name, bar.value]),
      [
        ["처음 온 사람", 64],
        ["다시 온 사람", 16]
      ]
    );
  });

  it("기기 세 칸(0 도), 나라는 많은 셋 + 기타, 한국은 대한민국", () => {
    assert.deepEqual(
      deviceBars(bundleOf()).map((bar) => [bar.name, bar.value]),
      [
        ["휴대폰", 30],
        ["컴퓨터", 20],
        ["태블릿", 0]
      ]
    );
    const countries = countryBars(bundleOf()).map((bar) => [bar.name, bar.value]);
    assert.equal(countries[0]?.[0], "대한민국");
    assert.equal(countries[0]?.[1], 42);
    assert.equal(countries.length, 4);
    assert.deepEqual(countries[3], ["기타", 2]);
  });

  it("성과 — 문의하기 누름은 lets_talk_click, 접수는 generate_lead, 신청은 event", () => {
    const map = new Map(outcomes(bundleOf()).map((item) => [item.id, item]));
    assert.equal(map.get("click")?.value, 3);
    assert.equal(map.get("lead")?.value, 1);
    assert.equal(map.get("newsletter")?.value, 2);
    assert.equal(map.get("talent")?.value, 0);
    assert.equal(map.get("talent")?.delta.delta, null);
  });

  it("답 문장", () => {
    assert.deepEqual(visitsAnswer(bundleOf()), {
      lead: "한 번에 ",
      em: "2.3개 페이지",
      tail: "를 보고, 평균 1분 22초 머물러요."
    });
  });
});
