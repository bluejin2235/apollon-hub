import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { aiVisitsSummary } from "../../components/website/stats/ai-data";
import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import {
  aiAnswer,
  botsDelta,
  readAiVisits,
  readBars,
  readBotsPayload,
  readTop,
  visitBars,
  visitSummary
} from "../../components/website/stats-v3/v3-ai-data";
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

  it("많이 읽어 간 콘텐츠는 llms.txt 를 빼고 다섯 줄까지", () => {
    const rows = readTop(readBotsPayload(bundleOf()), EMPTY_TITLES);
    assert.deepEqual(
      rows.map((row) => row.path),
      ["/works/a", "/en/about"]
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

  it("답 문장은 AI에서 온 방문 숫자로", () => {
    assert.deepEqual(aiAnswer(bundleOf()), {
      lead: "AI에서 ",
      em: "7회 방문",
      tail: "했고, 읽기와 인용은 따로 확인해야 해요."
    });
  });
});
