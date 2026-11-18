import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import {
  dwellByPath,
  hourGrid,
  peakCell,
  queriesForPath
} from "../../components/website/stats-v3/v3-fill-data";
import { normalizeKeyword, targetKeywordsView } from "../../components/website/stats-v3/v3-keywords-data";
import type { StatsBundle, StatsPoint, TargetKeywordsPayload } from "../../lib/website/stats";

function row(source: string, kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source, kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function result(kind: string, current: StatsPoint[], previous: StatsPoint[] = [], oldSite = false) {
  return {
    kind,
    from: "2026-11-17",
    to: "2026-11-18",
    prev_from: "2026-11-15",
    prev_to: "2026-11-16",
    actual_from: "2026-11-17",
    actual_to: "2026-11-18",
    prev_includes_pre_launch: oldSite,
    launch_date: "2026-11-11",
    current,
    previous,
    overall: [],
    overall_period: null,
    by_key: []
  } as unknown as StatsBundle[string];
}

describe("글별 머문 시간 (page_engagement)", () => {
  it("날짜별 평균을 사용자 수로 가중하고 경로 끝 / 를 맞춘다", () => {
    const bundle: StatsBundle = {
      page_engagement: result("page_engagement", [
        row("ga4", "page_engagement", "2026-11-17", { key: "/works/a/", avg_seconds: 60, users: 1 }),
        row("ga4", "page_engagement", "2026-11-18", { key: "/works/a", avg_seconds: 120, users: 3 })
      ])
    };
    assert.equal(dwellByPath(bundle)?.get("/works/a"), 105);
    assert.equal(dwellByPath({}), null);
  });
});

describe("이 글로 들어온 검색어 (query_page)", () => {
  it("경로가 같은 검색어를 클릭 많은 순으로", () => {
    const q = (key: string, key2: string, clicks: number, impressions: number) =>
      row("gsc", "query_page", "2026-11-17", { key, key2, clicks, impressions });
    const bundle: StatsBundle = {
      query_page: result("query_page", [
        q("미디어아트", "/works/a", 1, 10),
        q("미디어파사드", "/works/a", 3, 5),
        q("미디어아트", "/works/a", 1, 4),
        q("다른 글", "/works/b", 9, 9)
      ])
    };
    const list = queriesForPath(bundle, "/works/a/");
    assert.deepEqual(
      list.map((item) => [item.query, item.clicks, item.impressions]),
      [
        ["미디어파사드", 3, 5],
        ["미디어아트", 2, 14]
      ]
    );
  });
});

describe("요일과 시간대 (hourly)", () => {
  it("요일 × 3시간 칸으로 더하고 가장 많은 때를 찾는다", () => {
    // 2026-11-17 은 화요일
    const bundle: StatsBundle = {
      hourly: result("hourly", [
        row("ga4", "hourly", "2026-11-17", { key: "15", users: 4 }),
        row("ga4", "hourly", "2026-11-17", { key: "16", users: 2 }),
        row("ga4", "hourly", "2026-11-18", { key: "00", users: 1 })
      ])
    };
    const grid = hourGrid(bundle);
    assert.ok(grid);
    assert.equal(grid.cells[1][5], 6);
    assert.equal(grid.cells[2][0], 1);
    assert.equal(grid.total, 7);
    assert.equal(peakCell(grid), "화요일 15~18시");
    assert.equal(hourGrid({}), null);
  });
});

describe("목표 키워드 표", () => {
  const payload: TargetKeywordsPayload = {
    total: 2,
    goal: 30,
    top10: 1,
    not_seen: 1,
    rows: [
      {
        id: 1,
        keyword: "미디어파사드",
        lang: "ko",
        keyword_group: "대중어",
        priority: 2,
        target_page: "/expertise",
        current: { impressions: 40, clicks: 2, position: 8.25 },
        previous: { impressions: 20, clicks: 1, position: 12 },
        newly_seen: false,
        related_queries: 1
      },
      {
        id: 2,
        keyword: "media facade design",
        lang: "en",
        keyword_group: "영문",
        priority: 2,
        target_page: null,
        current: { impressions: 0, clicks: 0, position: null },
        previous: { impressions: 0, clicks: 0, position: null },
        newly_seen: false,
        related_queries: 0
      }
    ]
  };

  it("정규화는 홈페이지와 같다", () => {
    assert.equal(normalizeKeyword("미디어 파사드"), "미디어파사드");
    assert.equal(normalizeKeyword("Media-Facade  Design"), "mediafacadedesign");
  });

  it("순위·증감·들어온 페이지·추이를 만든다", () => {
    const bundle: StatsBundle = {
      target_keywords: { ...result("target_keywords", []), target_keywords: payload },
      query: result(
        "query",
        [
          row("gsc", "query", "2026-11-17", { key: "미디어 파사드", impressions: 30 }),
          row("gsc", "query", "2026-11-18", { key: "미디어파사드", impressions: 10 })
        ],
        [row("gsc", "query", "2026-11-15", { key: "미디어파사드", impressions: 20 })]
      ),
      query_page: result("query_page", [
        row("gsc", "query_page", "2026-11-17", { key: "미디어파사드", key2: "/expertise", clicks: 2, impressions: 30 }),
        row("gsc", "query_page", "2026-11-17", { key: "미디어파사드", key2: "/works", clicks: 0, impressions: 10 })
      ])
    };
    const view = targetKeywordsView(bundle, EMPTY_TITLES);
    assert.equal(view.hasLanding, true);
    const facade = view.rows[0];
    assert.equal(facade.position, "8.3");
    assert.equal(facade.change.type, "delta");
    assert.ok(facade.landing);
    assert.deepEqual(facade.trend.current, [30, 10]);
    assert.deepEqual(facade.trend.previous, [20]);
    assert.equal(view.rows[1].change.type, "none");
    assert.equal(view.rows[1].position, null);
  });

  it("앞 기간이 옛 사이트면 증감을 비운다 · 응답에 없으면 payload null", () => {
    const old: StatsBundle = {
      target_keywords: { ...result("target_keywords", [], [], true), target_keywords: payload }
    };
    assert.equal(targetKeywordsView(old, EMPTY_TITLES).rows[0].change.type, "none");
    assert.equal(targetKeywordsView({}, EMPTY_TITLES).payload, null);
  });
});

import { answerView } from "../../components/website/stats-v3/v3-answer-data";
import type { AiAnswerSummary } from "../../lib/website/stats";

describe("AI ② 답에 씀", () => {
  const count = (mentioned: number, checked: number) => ({
    mentioned,
    checked,
    previous: null,
    diff_pp: null,
    diff_count: null
  });
  const summary: AiAnswerSummary = {
    rounds: [{ checked_on: "2026-11-17", services: ["chatgpt", "google_ai_overview"], checks: 4 }],
    latest: "2026-11-17",
    previous: "2026-11-10",
    total: count(3, 4),
    services: [
      { ...count(2, 2), ai_service: "chatgpt", label: "ChatGPT" },
      { ...count(1, 2), ai_service: "google_ai_overview", label: "구글 AI 개요" }
    ],
    grid: [
      {
        question_id: 1,
        question: "미디어파사드 회사",
        group: "A",
        cells: {
          chatgpt: { mentioned: true, previous: false, changed: true },
          google_ai_overview: { mentioned: true, previous: true, changed: false }
        },
        changed: true
      },
      {
        question_id: 2,
        question: "미디어 아키텍처가 뭐야?",
        group: "A",
        cells: {
          chatgpt: { mentioned: true, previous: true, changed: false },
          google_ai_overview: { mentioned: false, previous: false, changed: false }
        },
        changed: false
      }
    ],
    cited_top: [{ url: "https://www.apollonworks.com/expertise", count: 2 }],
    wrong_facts: []
  };

  it("질문 단위 언급 수와 앞 회차를 센다", () => {
    const view = answerView(summary);
    assert.ok(view);
    assert.equal(view.questionsMentioned, 2);
    assert.equal(view.questionsChecked, 2);
    assert.equal(view.questionsMentionedBefore, 2);
    assert.equal(view.rows[0].id, 1);
    assert.equal(view.rows[0].diff, 1);
    assert.ok(view.columns.includes("ChatGPT"));
  });

  it("기록이 없으면 null", () => {
    assert.equal(answerView(null), null);
    assert.equal(answerView({ ...summary, latest: null }), null);
  });
});
