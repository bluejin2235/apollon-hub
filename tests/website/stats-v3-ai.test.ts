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
  readAiVisits,
  readBars,
  readBotsPayload,
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
  it("막대 넷(ChatGPT · Claude · Perplexity · 기타), 구글은 빼고 기타는 나머지 합", () => {
    const bars = readBars(readBotsPayload(bundleOf()));
    assert.deepEqual(
      bars.map((bar) => [bar.name, bar.value]),
      [
        ["ChatGPT", 12],
        ["Claude", 6],
        ["Perplexity", 2],
        ["기타", 5]
      ]
    );
    assert.equal(bars[3]?.change?.previous, "3회");
  });

  it("증감은 지금 AI 화면 countDelta 와 같고 앞 기간에 「회」", () => {
    const delta = botsDelta(readBotsPayload(bundleOf())?.ai.total);
    assert.equal(delta.delta, "▲ 50%");
    assert.equal(delta.previous, "20회");
  });

  it("앞 기간 시작이 로봇 기록 시작일 앞이면 비교 불가", () => {
    const payload = readBotsPayload(bundleOf("2026-11-14"));
    assert.equal(botsDelta(payload?.ai.total).delta, null);
    assert.ok(readBars(payload).every((bar) => bar.change?.delta == null));
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
    assert.deepEqual(aiAnswer(bundleOf()), {
      lead: "AI에서 ",
      em: "7회 방문",
      tail: "했고, 읽기와 인용은 따로 확인해야 해요."
    });
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

  it("답에 씀 열 — API 전엔 ChatGPT · 구글 AI 개요 · Claude · Perplexity, 기록 있는 서비스가 앞, 구글 AI 개요는 늘 들어감", () => {
    assert.deepEqual(answerColumns(), ["ChatGPT", "구글 AI 개요", "Claude", "Perplexity"]);
    assert.deepEqual(answerColumns(["Gemini", "Copilot", "Claude", "네이버"]), ["Gemini", "Copilot", "Claude", "구글 AI 개요"]);
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
