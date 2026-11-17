import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import { genericClicksOf } from "../../components/website/stats-v3/v3-data";
import {
  genericClickSeries,
  newQueries,
  searchAnswer,
  searchGroups,
  searchLandingTop,
  searchRange
} from "../../components/website/stats-v3/v3-search-data";
import type { StatsBundle, StatsPoint } from "../../lib/website/stats";

function row(source: string, kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source, kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function result(kind: string, current: StatsPoint[], previous: StatsPoint[], oldSite: boolean) {
  return {
    kind,
    actual_from: "2026-11-12",
    actual_to: "2026-11-14",
    prev_from: "2026-11-09",
    prev_to: "2026-11-11",
    prev_includes_pre_launch: oldSite,
    launch_date: "2026-11-11",
    gsc_last_date: "2026-11-13",
    current,
    previous,
    overall: []
  };
}

function bundleOf(oldSite = false): StatsBundle {
  const q = (date: string, key: string, clicks: number, impressions: number) =>
    row("gsc", "query", date, { key, clicks, impressions });
  return {
    daily: result(
      "daily",
      [row("gsc", "daily", "2026-11-12", { clicks: 9 }), row("gsc", "daily", "2026-11-13", { clicks: 4 })],
      [row("gsc", "daily", "2026-11-10", { clicks: 3 }), row("gsc", "daily", "2026-11-11", { clicks: 2 })],
      oldSite
    ),
    query: result(
      "query",
      [
        q("2026-11-12", "아폴론이머시브웍스", 5, 20),
        q("2026-11-12", "미디어아트", 2, 30),
        q("2026-11-13", "미디어아트", 1, 10),
        q("2026-11-13", "미디어파사드", 0, 12),
        q("2026-11-13", "apollon", 1, 3)
      ],
      [q("2026-11-10", "아폴론이머시브웍스", 3, 10), q("2026-11-11", "미디어아트", 0, 5)],
      oldSite
    ),
    landing_channel: result(
      "landing_channel",
      [
        row("ga4", "landing_channel", "2026-11-12", { key: "/works/a", key2: "Organic Search", sessions: 7 }),
        row("ga4", "landing_channel", "2026-11-13", { key: "/works/a", key2: "Organic Search", sessions: 3 }),
        row("ga4", "landing_channel", "2026-11-12", { key: "/en/about", key2: "Organic Search", sessions: 2 }),
        row("ga4", "landing_channel", "2026-11-12", { key: "/", key2: "Direct", sessions: 50 })
      ],
      [row("ga4", "landing_channel", "2026-11-10", { key: "/works/a", key2: "Organic Search", sessions: 4 })],
      oldSite
    )
  } as unknown as StatsBundle;
}

describe("v3 검색 — 회사 이름 · 일반 명사", () => {
  it("buildBrandSplit 숫자 그대로, 일반 명사 클릭은 요약 카드와 같은 값", () => {
    const groups = searchGroups(bundleOf());
    assert.equal(groups?.brand.clicks, "6");
    assert.equal(groups?.brand.impressions, "23");
    assert.equal(groups?.generic.clicks, "3");
    assert.equal(groups?.generic.impressions, "52");
    assert.equal(groups?.generic.clicks, String(genericClicksOf(bundleOf(), "current")));
    assert.equal(groups?.brand.delta.previous, "3회");
  });

  it("앞 기간이 옛 사이트면 증감 없이", () => {
    const groups = searchGroups(bundleOf(true));
    assert.equal(groups?.brand.delta.delta, null);
    assert.equal(groups?.generic.delta.delta, null);
  });

  it("검색 기간 끝은 구글 자료 마지막 날", () => {
    assert.deepEqual(searchRange(bundleOf()), {
      from: "2026-11-12",
      to: "2026-11-13",
      prevFrom: "2026-11-09",
      prevTo: "2026-11-11"
    });
  });

  it("일반 명사 클릭 추이 — 구글 일별 날짜 칸, 회사 이름은 빼고", () => {
    const series = genericClickSeries(bundleOf());
    assert.deepEqual(series.dates, ["2026-11-12", "2026-11-13"]);
    assert.deepEqual(series.current, [2, 1]);
    assert.deepEqual(series.previous, [0, 0]);
  });
});

describe("v3 검색 — 새로 잡힌 검색어 · 들어온 콘텐츠 · 답 문장", () => {
  it("앞 기간에 없던 일반 명사 검색어만, 노출 많은 순", () => {
    assert.deepEqual(newQueries(bundleOf()), [{ query: "미디어파사드", impressions: 12, clicks: 0 }]);
  });

  it("앞 기간이 옛 사이트면 비교 불가(null)", () => {
    assert.equal(newQueries(bundleOf(true)), null);
  });

  it("검색으로 들어온 페이지 — 경로별 합, 국영, 증감", () => {
    const rows = searchLandingTop(bundleOf(), EMPTY_TITLES);
    assert.deepEqual(
      rows.map((r) => [r.path, r.sessions, r.lang]),
      [
        ["/works/a", 10, "ko"],
        ["/en/about", 2, "en"]
      ]
    );
    // 앞 기간 4 는 % 를 내기엔 작다(공용 규칙) — 비교 불가
    assert.equal(rows[0]?.delta.delta, null);
    assert.equal(rows[1]?.delta.delta, "+2");
  });

  it("답 문장은 일반 명사 클릭 수로 채운다", () => {
    assert.deepEqual(searchAnswer(bundleOf()), {
      em: "일반 명사 검색으로 3회 클릭",
      tail: "되어, 회사 이름 밖에서도 찾아오고 있어요."
    });
  });
});
