/**
 * 사례·이미지 질문 — 노션 주입 상한 + 목록형 판정
 *   npx tsx scripts/verify-reference-inject-cap.ts
 */
import assert from "node:assert/strict";
import {
  llmInjectLimitsForQuestion,
  REFERENCE_IMAGE_NOTION_CAP
} from "../lib/luna/question-depth";
import { isListingQuestion } from "../lib/luna/listing-question";
import { hasImageSearchIntent } from "../lib/luna/media-index-search";
import { resolveSearchScopeKind } from "../lib/luna/search-scope";

const q = "우리가 한 미디어파사드 사례 보여줘";
assert.equal(isListingQuestion(q), true);
assert.equal(hasImageSearchIntent(q), true);
assert.equal(
  resolveSearchScopeKind({ types: ["find"], question: q }),
  "reference"
);

const uncapped = llmInjectLimitsForQuestion(q);
assert.equal(uncapped.depth, "listing");
assert.equal(uncapped.limits.notion, 12);

const capped = llmInjectLimitsForQuestion(q, { imagePrimary: true });
assert.equal(capped.depth, "listing");
assert.equal(capped.limits.notion, REFERENCE_IMAGE_NOTION_CAP);

console.log("reference inject cap ok", {
  notion: capped.limits.notion,
  cap: REFERENCE_IMAGE_NOTION_CAP
});
