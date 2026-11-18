import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { aiVisitsSummary } from "../../components/website/stats/ai-data";
import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import {
  aiAnswer,
  answerColumns,
  isInternalPath,
  botsDelta,
  companyRows,
  readAiVisits,
  readBotsPayload,
  searchEngineRows,
  readTop,
  visitBars,
  visitPages,
  visitSummary
} from "../../components/website/stats-v3/v3-ai-data";
import { fitLabel, markRoom } from "../../components/website/stats-v3/v3-chart";
import type { StatsBundle } from "../../lib/website/stats";

const pair = (current: number, previous: number | null) => ({ current, previous });

function bundleOf(prevFrom = "2026-11-16", withOther = false): StatsBundle {
  const range = {
    from: "2026-11-18",
    to: "2026-11-19",
    actual_from: "2026-11-18",
    actual_to: "2026-11-19",
    prev_from: prevFrom,
    prev_to: "2026-11-17",
    prev_includes_pre_launch: false,
    launch_date: "2026-11-11",
    current: [],
    previous: [],
    overall: []
  };
  return {
    bots: {
      ...range,
      kind: "bots",
      bots: {
        since: "2026-11-16",
        ai: {
          total: pair(30, 20),
          byCompany: {
            OpenAI: pair(12, 8),
            Anthropic: pair(6, 4),
            Perplexity: pair(2, 2),
            Google: pair(5, 3),
            ByteDance: pair(3, 1),
            Apple: pair(2, 2)
          },
          byPurpose: {},
          askedTotal: pair(8, 4),
          topPaths: [
            { path: "/works/a", lang: "ko", count: pair(9, 3) },
            { path: "/llms.txt", lang: "ko", count: pair(4, 1) },
            { path: "/en/about", lang: "en", count: pair(3, 0) }
          ],
          failed: pair(0, 0)
        },
        searchEngines: { total: pair(0, 0), byName: {} },
        verified: false
      }
    },
    ai_visits: {
      ...range,
      kind: "ai_visits",
      ai_visits: {
        current: {
          total: withOther ? 9 : 7,
          by_name: [
            { name: "ChatGPT", sessions: 4 },
            { name: "Perplexity", sessions: 3 },
            ...(withOther ? [{ name: "Copilot", sessions: 2 }] : [])
          ],
          top_pages: [{ path: "/works/a", lang: "ko", sessions: 5 }]
        },
        previous: { total: 5, by_name: [{ name: "ChatGPT", sessions: 5 }], top_pages: [] }
      }
    }
  } as unknown as StatsBundle;
}

describe("v3 AI ① 읽어 감", () => {
  it("회사별 줄 — 많은 순, 회사마다 쓰임, 「기타」로 뭉치지 않는다", () => {
    const rows = companyRows(readBotsPayload(bundleOf()));
    assert.deepEqual(
      rows.map((row) => [row.key, row.value]),
      [
        ["OpenAI", 12],
        ["Anthropic", 6],
        ["Google", 5],
        ["ByteDance", 3],
        ["Perplexity", 2],
        ["Apple", 2]
      ]
    );
    // 이름별 숫자가 없으면 실제로 온 로봇을 몰라 「로봇 종류」로만 적는다
    assert.equal(rows.find((row) => row.key === "ByteDance")?.purpose, "로봇 종류: 학습");
    assert.equal(rows.find((row) => row.key === "OpenAI")?.purpose, "로봇 종류: 물어봐서 읽음 · 검색 · 학습");
    assert.equal(rows[0]?.change?.previous, "8회");
  });

  it("표의 회사 · 숫자는 그래프와 같은 홈페이지 byCompany 하나만 쓴다 — 이름별 숫자가 와도 회사를 다시 나누지 않는다", () => {
    const payload = readBotsPayload(bundleOf());
    assert.ok(payload);
    payload.ai.byCompany = { OpenAI: pair(12, 8), Meta: pair(40, 1), 기타: pair(5, 1) };
    const plain = companyRows(payload);
    assert.deepEqual(
      plain.map((row) => [row.key, row.value]),
      [
        ["Meta", 40],
        ["OpenAI", 12],
        ["기타", 5]
      ]
    );
    assert.equal(plain[2]?.name, "기타 로봇 (회사 분류 없음)");
    assert.ok(!plain.some((row) => row.name.includes("Common Crawl")));
    payload.ai.byName = {
      "Meta-ExternalAgent": pair(38, 1),
      "Meta-ExternalFetcher": pair(2, 0),
      GPTBot: pair(12, 8),
      CCBot: pair(3, 1),
      WeirdBot: pair(2, 0)
    };
    const named = companyRows(payload);
    // 숫자는 여전히 byCompany 그대로
    assert.deepEqual(
      named.map((row) => [row.key, row.value]),
      [
        ["Meta", 40],
        ["OpenAI", 12],
        ["기타", 5]
      ]
    );
    // 쓰임은 그 줄에 실제로 온 로봇에서 — Meta 는 학습과 물어봐서 읽음이 섞였다
    assert.equal(named[0]?.purpose, "물어봐서 읽음 · 학습");
    assert.equal(named[1]?.purpose, "학습");
    // 홈페이지가 CCBot 을 기타로 두므로 회사 이름을 지어내지 않고 로봇 이름을 적는다
    assert.equal(named[2]?.purpose, "이름: CCBot, WeirdBot");
  });

  it("검색 엔진 로봇은 따로 — 구글 · 빙 · 네이버", () => {
    const payload = readBotsPayload(bundleOf());
    assert.ok(payload);
    payload.searchEngines.byName = { Googlebot: pair(308, null), Yeti: pair(60, null), Bingbot: pair(110, null) };
    assert.deepEqual(
      searchEngineRows(payload).map((row) => [row.name, row.purpose]),
      [
        ["Google", "검색"],
        ["Microsoft Bing", "검색"],
        ["Naver", "검색"]
      ]
    );
  });

  it("증감은 지금 AI 화면 countDelta 와 같고 앞 기간에 「회」", () => {
    const delta = botsDelta(readBotsPayload(bundleOf())?.ai.total);
    assert.equal(delta.delta, "▲ 50%");
    assert.equal(delta.previous, "20회");
  });

  it("앞 기간 시작이 로봇 기록 시작일 앞이면 비교 불가", () => {
    const payload = readBotsPayload(bundleOf("2026-11-14"));
    assert.equal(botsDelta(payload?.ai.total).delta, null);
    assert.ok(companyRows(payload).every((row) => row.change?.delta == null));
  });

  it("많이 읽어 간 콘텐츠는 llms.txt 도 횟수 순으로 넣고 다섯 줄까지", () => {
    const rows = readTop(readBotsPayload(bundleOf()), EMPTY_TITLES);
    assert.deepEqual(
      rows.map((row) => row.path),
      ["/works/a", "/llms.txt", "/en/about"]
    );
  });
});

describe("v3 AI ③ 사람이 옴", () => {
  it("카드 숫자는 요약 화면과 같은 aiVisitsSummary", () => {
    assert.equal(visitSummary(bundleOf())?.total, aiVisitsSummary(bundleOf())?.total);
    assert.equal(visitSummary(bundleOf())?.delta.delta, aiVisitsSummary(bundleOf())?.delta.delta);
    assert.equal(visitSummary(bundleOf())?.delta.previous, "5회");
  });

  it("목업 네 칸, 0 도 보이고 그 밖 서비스가 있으면 「그 밖」 한 칸", () => {
    const bars = visitBars(readAiVisits(bundleOf()));
    assert.deepEqual(
      bars.map((bar) => [bar.name, bar.value]),
      [
        ["ChatGPT", 4],
        ["Perplexity", 3],
        ["Claude", 0],
        ["Gemini", 0]
      ]
    );
    const more = visitBars(readAiVisits(bundleOf("2026-11-16", true)));
    assert.equal(more.length, 5);
    assert.deepEqual([more[4]?.name, more[4]?.value], ["그 밖", 2]);
    assert.equal(more.reduce((acc, bar) => acc + (bar.value ?? 0), 0), 9);
  });

  it("도착한 콘텐츠의 (not set) 줄은 「들어온 페이지 모름」, 숫자는 그대로", () => {
    const bundle = bundleOf();
    const visits = bundle.ai_visits as unknown as { ai_visits: { current: { top_pages: unknown[] } } };
    visits.ai_visits.current.top_pages.push({ path: "(not set)", lang: "ko", sessions: 1 });
    const rows = visitPages(readAiVisits(bundle), EMPTY_TITLES);
    assert.deepEqual(
      rows.map((row) => [row.title, row.sessions, row.unknown ?? false]),
      [
        [rows[0]?.title, 5, false],
        ["들어온 페이지 모름", 1, true]
      ]
    );
  });

  it("답 문장은 AI에서 온 방문 숫자로", () => {
    assert.equal(aiAnswer(bundleOf())?.em, "7회 방문");
  });
});

describe("v3 AI 빌드 뒤 수정", () => {
  it("많이 읽어 간 콘텐츠에서 /_next/ · /api/ 는 빼고 robots.txt · llms.txt 는 남긴다", () => {
    const payload = readBotsPayload(bundleOf());
    assert.ok(payload);
    payload.ai.topPaths = [
      { path: "/_next/image", lang: "ko", count: pair(20, 0) },
      { path: "/api/stats", lang: "ko", count: pair(10, 0) },
      { path: "/robots.txt", lang: "ko", count: pair(6, 0) },
      { path: "/works/a", lang: "ko", count: pair(9, 3) },
      { path: "/llms.txt", lang: "ko", count: pair(4, 1) }
    ];
    assert.deepEqual(
      readTop(payload, EMPTY_TITLES).map((row) => row.path),
      ["/works/a", "/robots.txt", "/llms.txt"]
    );
    assert.equal(isInternalPath("/_next/static/x.js"), true);
    assert.equal(isInternalPath("/apis"), false);
  });

  it("답에 나옴 열 — 확인한 서비스가 앞, 「구글 AI 개요」는 「구글 검색 AI 요약」으로, 다섯 칸", () => {
    assert.deepEqual(answerColumns(), ["ChatGPT", "구글 검색 AI 요약", "Perplexity", "Claude", "네이버"]);
    assert.deepEqual(answerColumns(["구글 AI 개요", "Gemini"]), ["구글 검색 AI 요약", "Gemini", "ChatGPT", "Perplexity", "Claude"]);
  });
});

describe("v3 그래프 세로선 글씨 폭", () => {
  it("넘치면 줄이고 「…」, 마주 보는 선 사이는 절반", () => {
    assert.equal(fitLabel("11-16 짧음", 500), "11-16 짧음");
    const cut = fitLabel("11-16 메뉴 검색 결과 화면 고치기", 80);
    assert.ok(cut.endsWith("…") && cut.length < 20);
    // 가운데 500 기준: 300 은 오른쪽으로, 700 은 왼쪽으로 — 사이 400 의 절반에서 여백을 뺀다
    assert.equal(markRoom([300, 700], 0, 1000, 500), 186);
    assert.equal(markRoom([300, 700], 1, 1000, 500), 186);
    // 오른쪽 끝 선은 왼쪽으로 쓴다
    assert.equal(markRoom([977], 0, 1000, 500), 970);
  });
});
