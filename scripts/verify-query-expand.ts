/**
 * 질의 표기 확장 단위 검증
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-query-expand.ts
 */
import assert from "node:assert/strict";
import {
  expandDateTokens,
  expandFloorTokens,
  expandGlossaryTokens,
  expandNumberTokens,
  expandQueryNotations
} from "../lib/luna/query-expand";
import {
  pickIlikeKeywords,
  pickLightKeywords,
  planNotionSearchKeywords
} from "../lib/luna/notion-keyword";

{
  const extra = expandDateTokens("2월 27일까지 완료 예정 항목 두 가지는?");
  assert.ok(extra.includes("2/27"), extra.join(","));
  assert.ok(extra.includes("02.27"), extra.join(","));
  assert.ok(extra.includes("0227"), extra.join(","));
  assert.ok(extra.includes("250227"), extra.join(","));
  assert.ok(extra.includes("260227"), extra.join(","));
}

{
  const extra = expandDateTokens("2021-06-17에 개장했나");
  assert.ok(extra.some((v) => v.includes("6/17") || v.includes("06/17")));
  assert.ok(extra.includes("210617"));
}

{
  const extra = expandNumberTokens("모바일이 1,300억을 차지했다");
  assert.ok(extra.includes("1300억"), extra.join(","));
  assert.ok(extra.includes("130000000000") || extra.includes("130,000,000,000"));
}

{
  const extra = expandFloorTokens("지상 17층과 3층, 삼층");
  assert.ok(extra.includes("17F"));
  assert.ok(extra.includes("3F"));
  assert.ok(extra.includes("3층"));
}

{
  const extra = expandGlossaryTokens("KV가 뭐야", [
    {
      term_ko: "키비주얼",
      term_en: "Key Visual",
      synonyms: ["KV", "키 비주얼"]
    }
  ]);
  assert.ok(extra.some((v) => /키비주얼|Key Visual|키 비주얼/i.test(v)), extra.join(","));
}

{
  const extra = expandGlossaryTokens("미디어파사드 사례", [
    {
      term_ko: "미디어파사드",
      term_en: "Media Facade",
      synonyms: ["미디어 파사드"]
    }
  ]);
  assert.ok(extra.some((v) => /Media Facade/i.test(v)));
  assert.ok(extra.includes("미디어 파사드"));
}

{
  const extra = expandGlossaryTokens(
    "Cars: Road Trip이 Walt Disney Studios Park에 정식 오픈한 날짜는 언제인가?",
    [
      {
        term_ko: "키비주얼",
        term_en: "Key Visual",
        synonyms: ["KV", "TD", "NDI"]
      }
    ]
  );
  assert.equal(extra.length, 0, extra.join(","));
}

{
  const all = expandQueryNotations("2월 27일 KV", [
    { term_ko: "키비주얼", term_en: "Key Visual", synonyms: ["KV"] }
  ]);
  assert.ok(all.extra.includes("2/27"));
  assert.ok(all.extra.some((v) => /키비주얼|Key Visual/i.test(v)));
}

{
  const plan = planNotionSearchKeywords(
    "2월 27일까지 완료 예정 항목 두 가지는?",
    "2월 27일까지 완료 예정 항목 두 가지는?",
    []
  );
  assert.ok(plan.extra.includes("2/27"), plan.extra.join(","));
  const ilike = pickIlikeKeywords(plan.keywords, plan.extra);
  assert.ok(ilike.includes("2/27") || ilike.includes("250227"), ilike.join(","));
  const light = pickLightKeywords(plan);
  assert.ok(light.length > 0);
  assert.ok(light.some((k) => /2\/27|250227|0227|02\.27/.test(k)), light.join(","));
}

console.log("OK query-expand");
