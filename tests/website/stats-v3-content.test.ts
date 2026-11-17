import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import {
  contentCards,
  contentKindOf,
  contentMoves,
  contentRows,
  filterAndSort,
  pageDaySeries,
  roundShares,
  sourceShares
} from "../../components/website/stats-v3/v3-content-data";
import type { V3Catalog } from "../../components/website/stats-v3/v3-catalog";
import type { StatsBundle, StatsPoint } from "../../lib/website/stats";

function ga(kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source: "ga4", kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function result(kind: string, current: StatsPoint[], previous: StatsPoint[], extra: Record<string, unknown> = {}) {
  return {
    kind,
    actual_from: "2026-11-12",
    actual_to: "2026-11-13",
    prev_from: "2026-11-10",
    prev_to: "2026-11-11",
    prev_includes_pre_launch: false,
    launch_date: "2026-11-11",
    current,
    previous,
    overall: [],
    ...extra
  };
}

function bundleOf(oldSite = false): StatsBundle {
  const flag = { prev_includes_pre_launch: oldSite };
  return {
    daily: result(
      "daily",
      [
        ga("daily", "2026-11-12", { views: 60, sessions: 30, avg_seconds: 80, engagement_rate: 0.6 }),
        ga("daily", "2026-11-13", { views: 40, sessions: 10, avg_seconds: 120, engagement_rate: 0.8 })
      ],
      [
        ga("daily", "2026-11-10", { views: 40, sessions: 20, avg_seconds: 60, engagement_rate: 0.5 }),
        ga("daily", "2026-11-11", { views: 40, sessions: 20, avg_seconds: 60, engagement_rate: 0.5 })
      ],
      flag
    ),
    page: result(
      "page",
      [
        ga("page", "2026-11-12", { key: "/works/a", views: 30 }),
        ga("page", "2026-11-13", { key: "/works/a", views: 20 }),
        ga("page", "2026-11-12", { key: "/insight/b", views: 12 }),
        ga("page", "2026-11-12", { key: "/about", views: 8 }),
        ga("page", "2026-11-13", { key: "/en/works/a", views: 5 })
      ],
      [
        ga("page", "2026-11-10", { key: "/works/a", views: 20 }),
        ga("page", "2026-11-11", { key: "/insight/b", views: 20 }),
        ga("page", "2026-11-11", { key: "/about", views: 8 })
      ],
      flag
    ),
    landing: result(
      "landing",
      [
        ga("landing", "2026-11-12", { key: "/works/a", sessions: 20, engagement_rate: 0.5 }),
        ga("landing", "2026-11-12", { key: "/", sessions: 10, engagement_rate: 0.9 })
      ],
      [ga("landing", "2026-11-10", { key: "/works/a", sessions: 10, engagement_rate: 0.5 })],
      flag
    ),
    landing_channel: result(
      "landing_channel",
      [
        ga("landing_channel", "2026-11-12", { key: "/works/a", key2: "Organic Search", sessions: 10 }),
        ga("landing_channel", "2026-11-12", { key: "/works/a", key2: "Direct", sessions: 6 }),
        ga("landing_channel", "2026-11-12", { key: "/works/a", key2: "Referral", sessions: 4 }),
        ga("landing_channel", "2026-11-12", { key: "/", key2: "Organic Search", sessions: 4 }),
        ga("landing_channel", "2026-11-12", { key: "/", key2: "Direct", sessions: 6 })
      ],
      [ga("landing_channel", "2026-11-10", { key: "/works/a", key2: "Organic Search", sessions: 5 })],
      flag
    ),
    ai_visits: result("ai_visits", [], [], {
      ...flag,
      ai_visits: {
        current: { total: 3, by_name: [{ name: "ChatGPT", sessions: 3 }], top_pages: [{ path: "/works/a", lang: "ko", sessions: 3 }] },
        previous: { total: 0, by_name: [], top_pages: [] }
      }
    })
  } as unknown as StatsBundle;
}

const catalog: V3Catalog = {
  works: [{ slug: "a", title: { ko: "작품 A" }, status: "published", published_at: "2026-11-12T01:00:00Z" }],
  insights: [{ slug: "b", title: { ko: "글 B" }, status: "published", published_at: "2026-10-01T01:00:00Z" }]
} as unknown as V3Catalog;

describe("v3 콘텐츠 카드", () => {
  it("조회 합 · 머문 시간(세션 무게) · 글로 바로 들어온 방문 · 검색→글 · 그냥 나간 비율", () => {
    const cards = new Map(contentCards(bundleOf()).map((card) => [card.id, card]));
    assert.equal(cards.get("views")?.value, "100");
    assert.equal(cards.get("views")?.delta.delta, "▲ 25%");
    assert.equal(cards.get("dwell")?.value, "1분 30");
    assert.equal(cards.get("articleEntries")?.value, "20");
    assert.equal(cards.get("searchToArticle")?.value, "71");
    assert.equal(cards.get("bounce")?.value, "35");
    // 그냥 나간 비율은 줄어야 좋다: 50% → 35% 는 좋음
    assert.equal(cards.get("bounce")?.delta.tone, "up");
  });

  it("앞 기간이 옛 사이트면 증감 없이", () => {
    for (const card of contentCards(bundleOf(true))) assert.equal(card.delta.delta, null);
  });
});

describe("v3 콘텐츠 표", () => {
  const rows = contentRows(bundleOf(), catalog, "2026-11-12", "2026-11-13");

  it("종류는 워크 · 인사이트 · 그 밖은 메뉴 페이지", () => {
    assert.equal(contentKindOf({ typeId: "work" }), "워크");
    assert.equal(contentKindOf({ typeId: "insight" }), "인사이트");
    assert.equal(contentKindOf({ typeId: "home" }), "메뉴 페이지");
    assert.equal(contentKindOf({ typeId: "about" }), "메뉴 페이지");
  });

  it("제목 · 국영 · 새 글(기간 안 공개)", () => {
    const a = rows.find((row) => row.path === "/works/a");
    const b = rows.find((row) => row.path === "/insight/b");
    const en = rows.find((row) => row.path === "/en/works/a");
    assert.equal(a?.title, "작품 A");
    assert.equal(a?.isNew, true);
    assert.equal(en?.locale, "en");
    assert.equal(en?.isNew, true);
    assert.equal(b?.isNew, false);
  });

  it("주로 어디서: AI 는 기타(리퍼럴)에서 덜어 옮기고 합은 100", () => {
    const shares = sourceShares(bundleOf());
    assert.deepEqual(shares.get("/works/a"), [50, 15, 30, 5]);
    assert.deepEqual(shares.get("/"), [40, 0, 60, 0]);
    assert.deepEqual(roundShares([33.4, 33.3, 33.3, 0]), [34, 33, 33, 0]);
  });

  it("거르기 · 순서", () => {
    assert.deepEqual(
      filterAndSort(rows, "메뉴 페이지", null, "views", false).map((row) => row.path),
      ["/about", "/"]
    );
    assert.deepEqual(
      filterAndSort(rows, "전체", "en", "views", false).map((row) => row.path),
      ["/en/works/a"]
    );
    assert.equal(filterAndSort(rows, "전체", null, "views", true)[0]?.path, "/en/works/a");
  });

  it("오른 · 내린 콘텐츠는 조회 증감 칸과 같은 값", () => {
    const moves = contentMoves(rows, bundleOf());
    assert.equal(moves.up[0]?.path, "/works/a");
    assert.equal(moves.up[0]?.delta.delta, rows.find((row) => row.path === "/works/a")?.delta.views.delta);
    assert.equal(moves.down[0]?.path, "/insight/b");
  });

  it("펼침 날짜별 조회 — 없는 날은 0, 앞 기간은 같은 순번 날짜", () => {
    const series = pageDaySeries(bundleOf(), "/insight/b");
    assert.deepEqual(series.dates, ["2026-11-12", "2026-11-13"]);
    assert.deepEqual(series.current, [12, 0]);
    assert.deepEqual(series.previous, [0, 20]);
  });
});
