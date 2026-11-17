import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import {
  botsPeriodBeforeSince,
  buildAiPurposeBars,
  buildAiTopContents,
  countDelta,
  type BotsStatsPayload
} from "../../components/website/stats/ai-data";
import { EMPTY_TITLES } from "../../components/website/stats/content-data";
import type { StatsBundle } from "../../lib/website/stats";

function pair(current: number, previous: number | null = 0) {
  return { current, previous };
}

function payloadOf(
  partial: Partial<BotsStatsPayload["ai"]> & { since?: string } = {}
): BotsStatsPayload {
  const { since = "2026-11-16", ...ai } = partial;
  return {
    since,
    verified: false,
    ai: {
      total: pair(10, 4),
      byCompany: {},
      byPurpose: {
        학습: pair(3, 1),
        검색: pair(2, 0),
        "물어봐서 읽음": pair(5, 2)
      },
      askedTotal: pair(5, 2),
      topPaths: [],
      failed: pair(0, 0),
      ...ai
    },
    searchEngines: { total: pair(1, 0), byName: {} }
  };
}

function botsBundle(
  botsPayload: BotsStatsPayload,
  range: { from: string; to: string; actual_to?: string }
): StatsBundle {
  return {
    bots: {
      kind: "bots",
      from: range.from,
      to: range.to,
      prev_from: "2026-10-01",
      prev_to: "2026-10-31",
      actual_from: range.from,
      actual_to: range.actual_to ?? range.to,
      bots: botsPayload
    }
  } as unknown as StatsBundle;
}

describe("countDelta → makeCountDelta", () => {
  it("앞·뒤 5 미만이면 +N", () => {
    assert.equal(countDelta(pair(3, 1)).delta, "+2");
    assert.equal(countDelta(pair(42, 21)).delta, "▲ 100%");
  });
});

describe("buildAiPurposeBars", () => {
  it("학습용 · 검색용 · 물어봐서 세 칸", () => {
    assert.deepEqual(
      buildAiPurposeBars(payloadOf()).map((row) => [row.name, row.value]),
      [
        ["학습용", 3],
        ["검색용", 2],
        ["물어봐서", 5]
      ]
    );
  });
});

describe("buildAiTopContents", () => {
  it("상위 10 + llms.txt 고정 줄, 목록에서 llms 제외", () => {
    const paths = Array.from({ length: 12 }, (_, i) => ({
      path: `/works/w${i}`,
      lang: "ko" as const,
      count: pair(20 - i, 1)
    }));
    paths.splice(2, 0, {
      path: "/llms.txt",
      lang: "ko",
      count: pair(7, 2)
    });
    const { rows, llms } = buildAiTopContents(
      payloadOf({ topPaths: paths }),
      EMPTY_TITLES
    );
    assert.equal(llms.path, "/llms.txt");
    assert.equal(llms.count, 7);
    assert.equal(llms.fixed, true);
    assert.equal(rows.length, 10);
    assert.ok(rows.every((row) => row.path !== "/llms.txt"));
    assert.equal(rows[0]?.path, "/works/w0");
  });

  it("llms.txt 가 없어도 고정 줄은 0", () => {
    const { llms } = buildAiTopContents(
      payloadOf({
        topPaths: [{ path: "/about", lang: "ko", count: pair(3, 1) }]
      }),
      EMPTY_TITLES
    );
    assert.equal(llms.count, 0);
    assert.equal(llms.delta.delta, null);
  });
});

describe("botsPeriodBeforeSince", () => {
  it("기간 끝이 since 앞이면 참", () => {
    const payload = payloadOf();
    assert.equal(
      botsPeriodBeforeSince(
        botsBundle(payload, { from: "2026-11-01", to: "2026-11-10" })
      ),
      true
    );
    assert.equal(
      botsPeriodBeforeSince(
        botsBundle(payload, { from: "2026-11-16", to: "2026-11-20" })
      ),
      false
    );
  });
});
