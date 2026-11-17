import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CONTEXT_FIELD_CHARS,
  readAltSuggestContext
} from "../../lib/website/alt-suggest-context";

describe("readAltSuggestContext — 글 정보 길이 상한", () => {
  it("kind 가 work·insight 가 아니면 null", () => {
    assert.equal(readAltSuggestContext(null), null);
    assert.equal(readAltSuggestContext({ kind: "page" }), null);
    assert.equal(readAltSuggestContext([]), null);
  });

  it("칸마다 200자까지만 남긴다", () => {
    const long = "가".repeat(5000);
    const ctx = readAltSuggestContext({ kind: "work", titleKo: long, fileName: "x".repeat(300) });
    assert.ok(ctx);
    assert.equal([...(ctx.titleKo ?? "")].length, MAX_CONTEXT_FIELD_CHARS);
    assert.equal((ctx.fileName ?? "").length, MAX_CONTEXT_FIELD_CHARS);
  });

  it("짧은 값은 그대로, 빈 값·문자열 아님은 null", () => {
    const ctx = readAltSuggestContext({ kind: "insight", titleKo: "  빛의 정원 ", titleEn: "", category: 3 });
    assert.ok(ctx);
    assert.equal(ctx.titleKo, "빛의 정원");
    assert.equal(ctx.titleEn, null);
    assert.equal(ctx.category, null);
  });
});
