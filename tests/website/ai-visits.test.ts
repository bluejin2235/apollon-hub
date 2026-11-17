import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import {
  aiVisitsSummary,
  buildAiVisitBars,
  buildAiVisitPages,
  readAiVisits
} from "../../components/website/stats/ai-data";
import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import { makeCountDelta } from "../../components/website/stats/stats-data";
import { buildSummaryCards } from "../../components/website/stats/summary-data";
import type { StatsBundle } from "../../lib/website/stats";

type Period = {
  total: number;
  by_name: { name: string; sessions: number }[];
  top_pages: { path: string; lang: "ko" | "en"; sessions: number }[];
};

function bundleOf(current: Period, previous: Period, prevIncludesPreLaunch = false): StatsBundle {
  return {
    ai_visits: {
      kind: "ai_visits",
      from: "2026-11-17",
      to: "2026-12-16",
      prev_from: "2026-10-18",
      prev_to: "2026-11-16",
      actual_from: "2026-11-17",
      actual_to: "2026-12-16",
      clipped_to_launch: false,
      prev_includes_pre_launch: prevIncludesPreLaunch,
      launch_date: "2026-11-11",
      ai_visits: { current, previous }
    }
  } as unknown as StatsBundle;
}

const current: Period = {
  total: 42,
  by_name: [
    { name: "ChatGPT", sessions: 30 },
    { name: "Perplexity", sessions: 8 },
    { name: "Claude", sessions: 3 },
    { name: "NewAI", sessions: 1 }
  ],
  top_pages: [
    { path: "/works/a", lang: "ko", sessions: 20 },
    { path: "/en/insight/b", lang: "en", sessions: 3 },
    { path: "/", lang: "ko", sessions: 2 }
  ]
};

const previousFull: Period = {
  total: 21,
  by_name: [{ name: "ChatGPT", sessions: 21 }],
  top_pages: [
    { path: "/works/a", lang: "ko", sessions: 10 },
    { path: "/en/insight/b", lang: "en", sessions: 1 },
    { path: "/about", lang: "ko", sessions: 10 }
  ]
};

describe("makeCountDelta", () => {
  it("앞·뒤 모두 5 미만이면 개수 차이", () => {
    assert.equal(makeCountDelta(3, 1, true, "1").delta, "+2");
    assert.equal(makeCountDelta(1, 4, true, "4").delta, "-3");
    assert.equal(makeCountDelta(2, 2, true, "2").delta, "0");
    assert.equal(makeCountDelta(3, 1, true, "1").tone, "up");
    assert.equal(makeCountDelta(0, 0, true, "0").delta, "0");
  });

  it("하나라도 5 이상이면 공용 % 규칙", () => {
    assert.equal(makeCountDelta(42, 21, true, "21").delta, "▲ 100%");
    // 앞 기간이 10 미만이면 % 를 숨기는 기존 규칙 그대로
    assert.equal(makeCountDelta(6, 3, true, "3").delta, null);
  });

  it("앞 기간 값이 없으면 비교 불가", () => {
    assert.equal(makeCountDelta(3, null, true, null).delta, null);
  });
});

describe("readAiVisits / aiVisitsSummary", () => {
  it("total 과 증감", () => {
    const summary = aiVisitsSummary(bundleOf(current, previousFull));
    assert.equal(summary?.total, 42);
    assert.equal(summary?.delta.delta, "▲ 100%");
    assert.equal(summary?.delta.previous, "21");
  });

  it("앞 기간이 오픈 전이면 비교 불가", () => {
    const bundle = bundleOf(current, previousFull, true);
    assert.equal(readAiVisits(bundle)?.previous, null);
    assert.equal(aiVisitsSummary(bundle)?.delta.delta, null);
  });

  it("응답이 없으면 null", () => {
    assert.equal(readAiVisits(null), null);
    assert.equal(aiVisitsSummary({} as StatsBundle), null);
  });

  it("요약 화면 카드와 AI 화면 카드가 같은 숫자", () => {
    for (const bundle of [bundleOf(current, previousFull), bundleOf(current, previousFull, true)]) {
      const card = buildSummaryCards(bundle).find((item) => item.id === "ai");
      const summary = aiVisitsSummary(bundle);
      assert.equal(card?.value, "42");
      assert.equal(card?.delta, summary?.delta.delta);
      assert.equal(card?.tone, summary?.delta.tone);
    }
  });
});

describe("buildAiVisitBars", () => {
  it("여섯 칸, 목록 밖 이름은 그 밖", () => {
    const bars = buildAiVisitBars(readAiVisits(bundleOf(current, previousFull)));
    assert.deepEqual(
      bars.map((row) => [row.name, row.value]),
      [
        ["ChatGPT", 30],
        ["Claude", 3],
        ["Perplexity", 8],
        ["Gemini", 0],
        ["Copilot", 0],
        ["그 밖", 1]
      ]
    );
  });

  it("응답이 없어도 여섯 칸이 0", () => {
    assert.deepEqual(
      buildAiVisitBars(null).map((row) => row.value),
      [0, 0, 0, 0, 0, 0]
    );
  });
});

describe("buildAiVisitPages", () => {
  it("이름·언어·세션·증감. 앞 기간 목록이 전부면 없는 페이지는 0", () => {
    const rows = buildAiVisitPages(readAiVisits(bundleOf(current, previousFull)), EMPTY_TITLES);
    assert.deepEqual(
      rows.map((row) => [row.path, row.langLabel, row.sessions, row.delta.delta]),
      [
        ["/works/a", "국문", 20, "▲ 100%"],
        ["/en/insight/b", "영문", 3, "+2"],
        ["/", "국문", 2, "+2"]
      ]
    );
  });

  it("앞 기간 목록이 잘렸으면 없는 페이지는 비교 불가", () => {
    const cut: Period = { ...previousFull, total: 30 };
    const rows = buildAiVisitPages(readAiVisits(bundleOf(current, cut)), EMPTY_TITLES);
    assert.equal(rows.find((row) => row.path === "/")?.delta.delta, null);
    assert.equal(rows.find((row) => row.path === "/en/insight/b")?.delta.delta, "+2");
  });

  it("앞 기간이 오픈 전이면 모두 비교 불가", () => {
    const rows = buildAiVisitPages(readAiVisits(bundleOf(current, previousFull, true)), EMPTY_TITLES);
    assert.ok(rows.every((row) => row.delta.delta === null));
  });
});
