import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import { aiDayBucket, aiDayRanges } from "../../components/website/stats-v3/v3-ai-days";
import { answerView } from "../../components/website/stats-v3/v3-answer-data";
import { tickIndexes, xPercent } from "../../components/website/stats-v3/v3-chart";
import { prevDatesOf } from "../../components/website/stats-v3/v3-data";
import { rangeForPreset, V3_DEFAULT_PRESET } from "../../components/website/stats-v3/v3-period";
import {
  brandSplitDays,
  gscDaySeries,
  hiddenQueryShare,
  searchGroups,
  trimPreviousToGsc
} from "../../components/website/stats-v3/v3-search-data";
import { trendFact } from "../../components/website/stats-v3/v3-trend";
import { entryRows, exitRows, PAGE_EXIT_SINCE } from "../../components/website/stats-v3/v3-visits-data";
import type { AiAnswerSummary, StatsBundle, StatsPoint } from "../../lib/website/stats";

function point(source: string, kind: string, date: string, extra: Partial<StatsPoint>): StatsPoint {
  return { source, kind, date, key: null, key2: null, ...extra } as StatsPoint;
}

function result(kind: string, current: StatsPoint[], previous: StatsPoint[] = [], more: Record<string, unknown> = {}) {
  return {
    from: "2026-11-11",
    to: "2026-11-17",
    actual_from: "2026-11-11",
    actual_to: "2026-11-17",
    prev_from: "2026-11-04",
    prev_to: "2026-11-10",
    prev_includes_pre_launch: false,
    launch_date: "2026-11-01",
    gsc_last_date: "2026-11-15",
    kind,
    current,
    previous,
    overall: [],
    ...more
  };
}

describe("처음 기간", () => {
  it("다섯 화면 모두 7일로 연다", () => {
    assert.equal(V3_DEFAULT_PRESET, "7d");
    assert.deepEqual(rangeForPreset(V3_DEFAULT_PRESET, "2026-11-18"), { from: "2026-11-11", to: "2026-11-17" });
  });
});

describe("그래프 자리", () => {
  it("가로 위치는 % — 양 끝 2% 띄움, 눈금은 많아도 정한 수", () => {
    assert.equal(xPercent(0, 7), 2);
    assert.equal(xPercent(6, 7), 98);
    assert.equal(xPercent(0, 1), 50);
    assert.equal(tickIndexes(30, 5).length, 5);
    assert.deepEqual(tickIndexes(3), [0, 1, 2]);
  });

  it("마우스 상자의 앞 기간 날짜는 기간 길이만큼 앞", () => {
    const bundle = { daily: result("daily", []) } as unknown as StatsBundle;
    assert.deepEqual(prevDatesOf(bundle, ["2026-11-11", "2026-11-14"]), ["2026-11-04", "2026-11-07"]);
    assert.deepEqual(prevDatesOf(null, ["2026-11-11"]), [null]);
  });
});

describe("추이 한 문장", () => {
  it("견줄 수 있으면 같은 날끼리 더해 늘었다 · 줄었다 · 비슷하다", () => {
    const up = trendFact({ name: "클릭", unit: "번", current: [5, 5, null], previous: [1, 1, 9] });
    assert.equal(up.tone, "up");
    assert.equal(up.fair, true);
    assert.match(up.text, /이번 10번 · 앞 기간 2번/);
    assert.equal(trendFact({ name: "클릭", unit: "번", current: [10], previous: [11] }).tone, "flat");
    assert.equal(trendFact({ name: "클릭", unit: "번", current: [10], previous: [40] }).tone, "down");
  });

  it("견줄 수 없으면 이유를 쓰고, 4일 넘으면 기간 안 앞쪽 · 뒤쪽을 견준다", () => {
    const fact = trendFact({ name: "노출", unit: "번", current: [1, 1, 9, 9], previous: [1, 1, 1, 1], unfairReason: "옛 사이트" });
    assert.equal(fact.fair, false);
    assert.equal(fact.fairText, "옛 사이트");
    assert.equal(fact.tone, "up");
    assert.match(fact.text, /앞쪽 2일\(2번\)보다 뒤쪽 2일\(18번\)이 늘었어요/);
    const short = trendFact({ name: "노출", unit: "번", current: [3, 4], previous: null });
    assert.equal(short.tone, "none");
    assert.match(short.text, /2일뿐/);
  });

  it("기록 시작 전이면 0 이 아니라 「기록 시작 전」", () => {
    const fact = trendFact({ name: "로봇", unit: "회", current: [null, null], previous: null, startsOn: "11월 16일" });
    assert.match(fact.text, /기록 시작 전/);
  });
});

describe("AI 날짜별", () => {
  it("31일까지는 하루씩, 넘으면 7일 묶음", () => {
    assert.equal(aiDayRanges("2026-11-11", "2026-11-17").length, 7);
    const weeks = aiDayRanges("2026-01-01", "2026-03-31");
    assert.equal(weeks[0].to, "2026-01-07");
    assert.equal(weeks[weeks.length - 1].to, "2026-03-31");
    assert.deepEqual(aiDayRanges("2026-11-18", "2026-11-17"), []);
  });

  it("기록 시작일 앞 날은 로봇 값을 비우고, 방문은 그대로", () => {
    const bundle = {
      bots: {
        bots: {
          since: "2026-11-16",
          ai: { total: { current: 0, previous: null }, byCompany: { OpenAI: { current: 0, previous: null } } }
        }
      },
      ai_visits: { ai_visits: { current: { total: 2 } } }
    } as unknown as StatsBundle;
    const before = aiDayBucket({ from: "2026-11-12", to: "2026-11-12" }, bundle);
    assert.equal(before.botsTotal, null);
    assert.equal(before.visits, 2);
    const after = aiDayBucket({ from: "2026-11-16", to: "2026-11-16" }, bundle);
    assert.equal(after.botsTotal, 0);
    assert.deepEqual(after.botsByCompany, { OpenAI: 0 });
  });
});

describe("검색 날짜별 · 숨긴 검색어 · 늦게 들어온 날", () => {
  const daily = (date: string, clicks: number, impressions: number) => point("gsc", "daily", date, { clicks, impressions });
  const query = (date: string, key: string, clicks: number, impressions: number) =>
    point("gsc", "query", date, { key, clicks, impressions });
  const bundle = {
    daily: result(
      "daily",
      [daily("2026-11-11", 2, 10), daily("2026-11-12", 1, 9), daily("2026-11-15", 3, 20)],
      [daily("2026-11-04", 1, 5), daily("2026-11-05", 0, 5), daily("2026-11-10", 9, 90)]
    ),
    query: result(
      "query",
      [query("2026-11-11", "아폴론", 2, 3), query("2026-11-12", "미디어아트", 0, 2)],
      [query("2026-11-04", "아폴론", 1, 1), query("2026-11-10", "아폴론", 9, 9)]
    )
  } as unknown as StatsBundle;

  it("일별 합계 · 앞 기간은 같은 순번 날짜", () => {
    const series = gscDaySeries(bundle, "clicks");
    assert.deepEqual(series.dates, ["2026-11-11", "2026-11-12", "2026-11-15"]);
    assert.deepEqual(series.prevDates, ["2026-11-04", "2026-11-05", "2026-11-08"]);
    assert.deepEqual(series.previous, [1, 0, null]);
  });

  it("회사 이름 · 일반 명사 · 구글이 숨긴 몫은 합계에서 뺀 나머지", () => {
    const split = brandSplitDays(bundle, "impressions");
    assert.deepEqual(split.brand, [3, 0, 0]);
    assert.deepEqual(split.generic, [0, 2, 0]);
    assert.deepEqual(split.hidden, [7, 7, 20]);
    assert.deepEqual(hiddenQueryShare(bundle), { impressions: 39, clicks: 6, listedImpressions: 5, listedClicks: 2 });
  });

  it("구글 자료가 11월 15일까지면 앞 기간도 같은 날 수(11월 4~8일)까지만 견준다", () => {
    const trimmed = trimPreviousToGsc(bundle);
    assert.deepEqual(
      trimmed?.query.previous.map((row) => row.date),
      ["2026-11-04"]
    );
    // 11월 10일 9클릭이 빠져 회사 이름 클릭 앞 기간은 1
    assert.equal(searchGroups(bundle)?.brand.delta.previous, "1회");
  });
});

describe("방문 패턴 · 들어온 곳 나간 곳", () => {
  const landing = (key: string, sessions: number) => point("ga4", "landing", "2026-11-12", { key, sessions });
  const channel = (key: string, key2: string, sessions: number) =>
    point("ga4", "landing_channel", "2026-11-12", { key, key2, sessions });

  it("들어온 페이지 — 몫과 어디서 왔나, (not set)은 따로 센다", () => {
    const bundle = {
      landing: result("landing", [landing("/", 6), landing("/works/a", 2), landing("(not set)", 2)]),
      landing_channel: result("landing_channel", [channel("/", "Organic Search", 3), channel("/", "Direct", 3)])
    } as unknown as StatsBundle;
    const { rows, total, unknown } = entryRows(bundle, EMPTY_TITLES);
    assert.equal(total, 10);
    assert.equal(unknown, 2);
    assert.deepEqual(rows.map((row) => [row.path, row.sessions, row.share]), [
      ["/", 6, 60],
      ["/works/a", 2, 20]
    ]);
    assert.deepEqual(rows[0].sources, [50, 0, 50, 0]);
  });

  it("나간 페이지 — page_exit 의 events, 없으면 빈 목록(어림하지 않음)", () => {
    assert.equal(PAGE_EXIT_SINCE, "2026-11-19");
    assert.deepEqual(exitRows(null, EMPTY_TITLES), { rows: [], total: 0 });
    const bundle = {
      page_exit: result("page_exit", [
        point("ga4", "page_exit", "2026-11-19", { key: "/contact", events: 3 }),
        point("ga4", "page_exit", "2026-11-20", { key: "/contact/", events: 1 }),
        point("ga4", "page_exit", "2026-11-20", { key: "/", events: 4 })
      ])
    } as unknown as StatsBundle;
    const exits = exitRows(bundle, EMPTY_TITLES);
    assert.equal(exits.total, 8);
    assert.deepEqual(exits.rows.map((row) => [row.path, row.exits, row.share]), [
      ["/", 4, 50],
      ["/contact", 4, 50]
    ]);
  });
});

describe("AI 답변에 나옴 표", () => {
  const summary: AiAnswerSummary = {
    rounds: [{ checked_on: "2026-11-17", services: ["chatgpt", "google_ai_overview", "perplexity"], checks: 5 }],
    latest: "2026-11-17",
    previous: null,
    total: { mentioned: 2, checked: 5, previous: null, diff_pp: null, diff_count: null },
    services: [
      { ai_service: "chatgpt", label: "ChatGPT", mentioned: 1, checked: 2, previous: null, diff_pp: null, diff_count: null },
      { ai_service: "google_ai_overview", label: "구글 AI 개요", mentioned: 1, checked: 2, previous: null, diff_pp: null, diff_count: null },
      { ai_service: "perplexity", label: "Perplexity", mentioned: 0, checked: 1, previous: null, diff_pp: null, diff_count: null }
    ],
    grid: [
      {
        question_id: 1,
        question: "q1",
        group: "A",
        cells: {
          chatgpt: { mentioned: true, previous: null, changed: false },
          google_ai_overview: { mentioned: false, previous: null, changed: false },
          perplexity: { mentioned: false, previous: null, changed: false }
        },
        changed: false
      },
      {
        question_id: 2,
        question: "q2",
        group: "A",
        cells: {
          chatgpt: {
            mentioned: false,
            previous: null,
            changed: false
          },
          google_ai_overview: {
            mentioned: true,
            previous: null,
            changed: false,
            answer_excerpt: "아폴론이머시브웍스가 만들었다",
            cited_urls: ["https://www.apollonworks.com/works/a"],
            rank_in_answer: 2
          }
        },
        changed: false
      }
    ],
    cited_top: [],
    wrong_facts: [{ question_id: 1, question: "q1", ai_service: "chatgpt", label: "ChatGPT", note: "협업사 빠짐" }]
  };

  it("확인 안 한 칸은 「안 나옴」이 아니라 확인 안 함(null), 열 이름은 구글 검색 AI 요약", () => {
    const view = answerView(summary);
    assert.ok(view);
    assert.deepEqual(view.columns.map((col) => [col.label, col.checked]), [
      ["ChatGPT", 2],
      ["구글 검색 AI 요약", 2],
      ["Perplexity", 1],
      ["Claude", 0],
      ["네이버", 0]
    ]);
    const q2 = view.rows.find((row) => row.id === 2);
    assert.equal(q2?.cells[2].mentioned, null);
    assert.equal(q2?.cells[3].mentioned, null);
  });

  it("칸마다 답변 내용 · 인용 주소 · 순서 · 틀린 사실, 홈페이지가 안 보냈으면 detailSent=false", () => {
    const view = answerView(summary);
    const q2 = view?.rows.find((row) => row.id === 2);
    assert.equal(q2?.cells[1].excerpt, "아폴론이머시브웍스가 만들었다");
    assert.deepEqual(q2?.cells[1].cited, ["https://www.apollonworks.com/works/a"]);
    assert.equal(q2?.cells[1].rank, 2);
    assert.equal(q2?.cells[1].detailSent, true);
    const q1 = view?.rows.find((row) => row.id === 1);
    assert.equal(q1?.cells[0].detailSent, false);
    assert.equal(q1?.cells[0].wrongNote, "협업사 빠짐");
  });
});
