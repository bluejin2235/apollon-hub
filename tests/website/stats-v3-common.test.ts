import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import {
  actionsInRange,
  chartMarks,
  daySeries,
  durationParts,
  isArticlePath
} from "../../components/website/stats-v3/v3-data";
import { compareLine, particle, rangeForPreset } from "../../components/website/stats-v3/v3-period";
import type { StatsAction, StatsBundle, StatsPoint } from "../../lib/website/stats";

function action(date: string, title: string, created = "2026-11-17T00:00:00Z"): StatsAction {
  return {
    id: `${date}-${title}`,
    action_date: date,
    title,
    category: null,
    note: null,
    created_by: null,
    created_at: created,
    updated_at: created
  };
}

function row(date: string, users: number): StatsPoint {
  return { source: "ga4", kind: "daily", date, key: null, key2: null, users } as StatsPoint;
}

const bundle = {
  daily: {
    launch_date: "2026-11-11",
    actual_from: "2026-11-11",
    actual_to: "2026-11-16",
    prev_from: "2026-11-05",
    prev_to: "2026-11-10"
  }
} as unknown as StatsBundle;

describe("v3 비교 줄", () => {
  it("목업처럼 「A ~ B ↔ C ~ D와 비교」", () => {
    const api = { actualFrom: "2026-11-11", actualTo: "2026-11-16", prevFrom: "2026-11-05", prevTo: "2026-11-10", clipped: true, prevIncludesPreLaunch: true };
    assert.equal(compareLine("30d", "2026-10-18", "2026-11-16", "2026-11-17", api), "11월 11일 ~ 11월 16일 ↔ 11월 5일 ~ 11월 10일과 비교");
  });

  it("어제는 (어제) · (그저께)", () => {
    const api = { actualFrom: "2026-11-16", actualTo: "2026-11-16", prevFrom: "2026-11-15", prevTo: "2026-11-15", clipped: false, prevIncludesPreLaunch: false };
    assert.equal(compareLine("yesterday", "2026-11-16", "2026-11-16", "2026-11-17", api), "11월 16일 (어제) ↔ 11월 15일 (그저께)와 비교");
  });

  it("기간 버튼은 어제까지", () => {
    assert.deepEqual(rangeForPreset("7d", "2026-11-17"), { from: "2026-11-10", to: "2026-11-16" });
  });
});

describe("v3 글 도우미", () => {
  it("받침에 따라 조사를 고른다", () => {
    assert.equal(particle("미디어 아키텍처 디자인이란", "을", "를"), "을");
    assert.equal(particle("Under the Blueland", "을", "를"), "를");
    assert.equal(particle("홈", "을", "를"), "을");
  });

  it("머문 시간은 「1분 24」+「초」", () => {
    assert.deepEqual(durationParts(84), { value: "1분 24", unit: "초" });
    assert.deepEqual(durationParts(65), { value: "1분 05", unit: "초" });
    assert.deepEqual(durationParts(42), { value: "42", unit: "초" });
    assert.equal(durationParts(null), null);
  });

  it("워크·인사이트 글만 글이다", () => {
    assert.equal(isArticlePath("/works/under-the-blueland"), true);
    assert.equal(isArticlePath("/en/insight/a/"), true);
    assert.equal(isArticlePath("/works"), false);
    assert.equal(isArticlePath("/en"), false);
  });
});

describe("v3 그래프 세로선", () => {
  const dates = ["2026-11-11", "2026-11-12", "2026-11-13"];

  it("같은 날 조치는 한 선에 함께, 적은 순서대로", () => {
    const marks = chartMarks(
      dates,
      [action("2026-11-11", "검색 설명 수정", "2026-11-12T00:00:00Z"), action("2026-11-11", "새 홈페이지 오픈", "2026-11-11T00:00:00Z")],
      bundle
    );
    assert.deepEqual(marks, [{ index: 0, labels: ["11-11 새 홈페이지 오픈", "11-11 검색 설명 수정"] }]);
  });

  it("오픈일 조치가 없으면 오픈 선을 더한다", () => {
    assert.deepEqual(chartMarks(dates, [action("2026-11-13", "워크 JSON-LD 개선")], bundle), [
      { index: 0, labels: ["11-11 새 홈페이지 오픈"] },
      { index: 2, labels: ["11-13 워크 JSON-LD 개선"] }
    ]);
  });

  it("기간 밖 조치는 목록에서 뺀다", () => {
    const list = actionsInRange([action("2026-11-10", "옛"), action("2026-11-16", "새")], bundle, "2026-10-18", "2026-11-16");
    assert.deepEqual(list.map((item) => item.title), ["새"]);
  });

  it("앞 기간은 같은 순번 날짜", () => {
    const series = daySeries(
      [row("2026-11-12", 5), row("2026-11-11", 3)],
      [row("2026-11-09", 2), row("2026-11-10", 4)],
      (r) => r.users
    );
    assert.deepEqual(series, { dates: ["2026-11-11", "2026-11-12"], current: [3, 5], previous: [2, 4] });
  });
});
