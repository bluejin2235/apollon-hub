/**
 * 사례·이미지 질문 — 노션·위키 주입 상한 + 「우리가」 스톱워드
 *   npx tsx scripts/verify-reference-inject-cap.ts
 */
import assert from "node:assert/strict";
import {
  llmInjectLimitsForQuestion,
  REFERENCE_IMAGE_NOTION_CAP,
  REFERENCE_IMAGE_WIKI_CAP,
  wikiLimitsForDepth
} from "../lib/luna/question-depth";
import {
  isListingQuestion,
  LISTING_ANSWER_RULE,
  formatListingWikiChecklist
} from "../lib/luna/listing-question";
import { hasImageSearchIntent } from "../lib/luna/media-index-search";
import { resolveSearchScopeKind } from "../lib/luna/search-scope";
import { splitKeywordQuery } from "../lib/luna/knowledge-match";

const q = "우리가 한 미디어파사드 사례 보여줘";
assert.equal(isListingQuestion(q), true);
assert.equal(hasImageSearchIntent(q), true);
assert.equal(
  resolveSearchScopeKind({ types: ["find"], question: q }),
  "reference"
);

const kws = splitKeywordQuery(q, q);
assert.ok(!kws.includes("우리가"), `stopword leak: ${kws.join(",")}`);
assert.ok(!kws.includes("보여줘"), `stopword leak: ${kws.join(",")}`);
assert.ok(
  kws.some((k) => /미디어|파사드|사례/.test(k)),
  kws.join(",")
);

const uncapped = llmInjectLimitsForQuestion(q);
assert.equal(uncapped.depth, "listing");
assert.equal(uncapped.limits.notion, 12);
assert.equal(uncapped.limits.wikiSections, 12);

const capped = llmInjectLimitsForQuestion(q, { imagePrimary: true });
assert.equal(capped.depth, "listing");
assert.equal(capped.limits.notion, REFERENCE_IMAGE_NOTION_CAP);
assert.equal(capped.limits.wikiSections, REFERENCE_IMAGE_WIKI_CAP);

const wikiLim = wikiLimitsForDepth(capped.depth, capped.limits);
assert.equal(wikiLim.sectionMax, REFERENCE_IMAGE_WIKI_CAP);

assert.ok(LISTING_ANSWER_RULE.includes("맞지 않는 자료는 언급하지 마라"));
const checklist = formatListingWikiChecklist([
  {
    slug: "devnote-00",
    title: "개발노트 00",
    category: "guide",
    section_id: "a",
    section_title: "x",
    score: 1,
    matched_keywords: [],
    excerpt: "",
    path: "/wiki/devnote-00",
    visible_to_staff: true,
    cite_publicly: true
  }
]);
assert.ok(checklist.includes("맞지 않는 문서는 답에 쓰지 마라"), checklist);
assert.ok(!/해당 없으면.*조건과 맞지 않음/.test(checklist), checklist);

console.log("reference inject cap ok", {
  keywords: kws,
  notion: capped.limits.notion,
  wiki: capped.limits.wikiSections
});
