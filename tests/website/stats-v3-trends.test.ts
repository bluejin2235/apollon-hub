import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import { aiDayBucket, aiDayRanges, bucketRangeText } from "../../components/website/stats-v3/v3-ai-days";
import { answerView } from "../../components/website/stats-v3/v3-answer-data";
import { axisLabel, tickIndexes, valueSegments, xPercent } from "../../components/website/stats-v3/v3-chart";
import { pageDaySeries } from "../../components/website/stats-v3/v3-content-data";
import { prevDatesOf } from "../../components/website/stats-v3/v3-data";
import { overviewTrend } from "../../components/website/stats-v3/v3-overview-data";
import { rangeForPreset, V3_DEFAULT_PRESET } from "../../components/website/stats-v3/v3-period";
import {
  brandSplitDays,
  gscDaySeries,
  hiddenQueryShare,
  queryCoverage,
  searchGroups,
  targetKeywordDays,
  trimQueriesToCoverage
} from "../../components/website/stats-v3/v3-search-data";
import { trendFact } from "../../components/website/stats-v3/v3-trend";
import { depthTrend, dwellTrend, entryRows, exitRows, PAGE_EXIT_SINCE } from "../../components/website/stats-v3/v3-visits-data";
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

  it("회사 이름 · 일반 명사 · 구글이 숨긴 몫은 합계에서 뺀 나머지, 검색어 행이 없는 날은 0 이 아니라 null", () => {
    const split = brandSplitDays(bundle, "impressions");
    assert.deepEqual(split.brand, [3, 0, null]);
    assert.deepEqual(split.generic, [0, 2, null]);
    // 11월 15일 합계 20 이 통째로 「숨긴 검색어」가 되지 않는다
    assert.deepEqual(split.hidden, [7, 7, null]);
    assert.deepEqual(split.missing, ["2026-11-15"]);
    assert.deepEqual(hiddenQueryShare(bundle), {
      impressions: 19,
      clicks: 3,
      listedImpressions: 5,
      listedClicks: 2,
      missing: ["2026-11-15"]
    });
  });

  it("검색어 행이 11월 12일까지면 두 기간 모두 앞 2일(11월 11~12일 · 11월 4~5일)만 견준다", () => {
    assert.deepEqual(queryCoverage(bundle), {
      from: "2026-11-11",
      to: "2026-11-12",
      days: 2,
      prevFrom: "2026-11-04",
      prevTo: "2026-11-05"
    });
    const trimmed = trimQueriesToCoverage(bundle);
    assert.deepEqual(trimmed?.query.previous.map((row) => row.date), ["2026-11-04"]);
    // 11월 10일 9클릭이 빠져 회사 이름 클릭 앞 기간은 1
    assert.equal(searchGroups(bundle)?.brand.delta.previous, "1회");
  });

  it("일별 합계 마지막 날(11월 15일)이 아니라 검색어 행 마지막 날로 자른다", () => {
    const lagging = {
      ...bundle,
      query: result(
        "query",
        [query("2026-11-11", "아폴론", 2, 3), query("2026-11-12", "아폴론", 1, 2)],
        [query("2026-11-04", "아폴론", 1, 1), query("2026-11-06", "아폴론", 5, 5)]
      )
    } as unknown as StatsBundle;
    // 합계 기준(5일)이면 앞 기간 11월 6일 5클릭까지 들어가 6. 검색어 기준(2일)이면 1
    assert.equal(searchGroups(lagging)?.brand.delta.previous, "1회");
  });

  it("앞 기간 검색어 행이 더 짧게 끝나면 이번 기간도 그 날 수로 줄인다", () => {
    const short = {
      ...bundle,
      query: result(
        "query",
        [query("2026-11-11", "아폴론", 2, 3), query("2026-11-12", "아폴론", 4, 4), query("2026-11-13", "아폴론", 8, 8)],
        [query("2026-11-04", "아폴론", 1, 1)]
      )
    } as unknown as StatsBundle;
    assert.equal(queryCoverage(short)?.days, 1);
    assert.equal(searchGroups(short)?.brand.clicks, "2");
  });

  it("목표 키워드 날짜별도 검색어 행이 없는 날은 null", () => {
    const withTarget = {
      ...bundle,
      target_keywords: { target_keywords: { rows: [{ keyword: "아폴론" }] } }
    } as unknown as StatsBundle;
    assert.deepEqual(targetKeywordDays(withTarget)?.current, [3, 0, null]);
  });
});

describe("앞 기간 값은 날짜로 찾는다 (빠진 날이 있어도 밀리지 않음)", () => {
  const ga = (date: string, extra: Partial<StatsPoint>) => point("ga4", "daily", date, extra);
  // 앞 기간 11월 5일이 빠졌다. 순번으로 짝지으면 11월 12일 자리에 11월 6일 값이 들어간다
  const bundle = {
    daily: result(
      "daily",
      [
        ga("2026-11-11", { users: 10, views: 20, sessions: 10, avg_seconds: 60 }),
        ga("2026-11-12", { users: 11, views: 33, sessions: 11, avg_seconds: 70 }),
        ga("2026-11-13", { users: 12, views: 24, sessions: 12, avg_seconds: 80 })
      ],
      [
        ga("2026-11-04", { users: 1, views: 2, sessions: 1, avg_seconds: 10 }),
        ga("2026-11-06", { users: 3, views: 9, sessions: 3, avg_seconds: 30 })
      ]
    ),
    page: result(
      "page",
      [point("ga4", "page", "2026-11-11", { key: "/works/a", views: 4 })],
      [point("ga4", "page", "2026-11-06", { key: "/works/a", views: 7 })]
    )
  } as unknown as StatsBundle;

  it("요약 방문자 추이", () => {
    assert.deepEqual(overviewTrend(bundle).previous, [1, null, 3]);
  });

  it("방문 패턴 한 번에 본 페이지 수 · 머문 시간", () => {
    assert.deepEqual(depthTrend(bundle).previous, [2, null, 3]);
    assert.deepEqual(dwellTrend(bundle).previous, [10, null, 30]);
  });

  it("콘텐츠 펼침 — 사이트 자료가 있는 날은 0, 없는 날은 null", () => {
    const series = pageDaySeries(bundle, "/works/a");
    assert.deepEqual(series.current, [4, 0, 0]);
    assert.deepEqual(series.previous, [0, null, 7]);
  });

  it("그래프는 빈 날에서 선을 끊는다", () => {
    assert.deepEqual(valueSegments([1, null, 3, 4]), [[0], [2, 3]]);
    assert.deepEqual(valueSegments([null, null]), []);
  });
});

describe("AI 묶음 칸 — 길이가 다른 칸은 하루 평균으로", () => {
  it("칸마다 날 수, 로봇은 기록 시작일부터 센 날 수", () => {
    const ranges = aiDayRanges("2026-10-01", "2026-11-19");
    const last = ranges[ranges.length - 1];
    assert.equal(last.from, "2026-11-19");
    const bundle = {
      bots: { bots: { since: "2026-11-16", ai: { total: { current: 7, previous: null }, byCompany: {} } } },
      ai_visits: { ai_visits: { current: { total: 7 } } }
    } as unknown as StatsBundle;
    const week = aiDayBucket({ from: "2026-11-12", to: "2026-11-18" }, bundle);
    assert.equal(week.days, 7);
    assert.equal(week.botDays, 3);
    assert.equal(aiDayBucket(last, bundle).days, 1);
  });

  it("마우스 상자에는 묶음의 두 날짜와 날 수", () => {
    assert.equal(bucketRangeText({ from: "2026-11-12", to: "2026-11-18" }, axisLabel), "11월 12일~11월 18일 (7일)");
    assert.equal(bucketRangeText({ from: "2026-11-12", to: "2026-11-12" }, axisLabel), "11월 12일");
  });

  it("7일 묶음 넷 + 하루짜리 한 칸 — 합으로 견주면 줄어 보이지만 하루 평균은 같다", () => {
    const flat = trendFact({
      name: "방문",
      unit: "회",
      current: [70, 70, 70, 70, 10],
      days: [7, 7, 7, 7, 1],
      previous: null
    });
    assert.equal(flat.tone, "flat");
    assert.match(flat.text, /하루 평균 10회/);
    assert.match(flat.fairText, /하루 평균으로 견줬어요/);
    const up = trendFact({ name: "방문", unit: "회", current: [7, 7, 70, 70, 20], days: [7, 7, 7, 7, 1], previous: null });
    assert.equal(up.tone, "up");
    assert.match(up.text, /앞쪽 14일\(하루 평균 1회\)보다 뒤쪽 8일\(하루 평균 11.3회\)이 늘었어요/);
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
    assert.deepEqual(exitRows(null, EMPTY_TITLES), { rows: [], total: 0, comparable: false });
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

  it("나간 페이지 증감 — 두 기간이 모두 11월 19일 뒤일 때만, 아니면 비교 불가", () => {
    const exit = (date: string, key: string, events: number) => point("ga4", "page_exit", date, { key, events });
    const range = (actualFrom: string, actualTo: string, prevFrom: string, prevTo: string) => ({
      actual_from: actualFrom,
      actual_to: actualTo,
      prev_from: prevFrom,
      prev_to: prevTo
    });
    // 앞 기간(11월 13~19일)은 대부분 모으기 전이라, 앞 기간 1회와 견주면 크게 는 것처럼 보인다
    const early = {
      page_exit: result("page_exit", [exit("2026-11-20", "/", 9)], [exit("2026-11-19", "/", 1)], range("2026-11-20", "2026-11-26", "2026-11-13", "2026-11-19"))
    } as unknown as StatsBundle;
    const before = exitRows(early, EMPTY_TITLES);
    assert.equal(before.comparable, false);
    assert.equal(before.rows[0]?.delta.delta, null);
    const later = {
      page_exit: result("page_exit", [exit("2026-11-27", "/", 9)], [exit("2026-11-20", "/", 6)], range("2026-11-27", "2026-12-03", "2026-11-20", "2026-11-26"))
    } as unknown as StatsBundle;
    const after = exitRows(later, EMPTY_TITLES);
    assert.equal(after.comparable, true);
    assert.equal(after.rows[0]?.delta.previous, "6회");
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
