import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

const { searchNotionPages } = await import("../lib/luna/notion.ts");

const keywords = "청담 오피스라운지 제안서";
const queryContext = "청담 오피스라운지 제안서 찾아줘";

const EXPECTED_TITLES = [
  "230628 청담동 오피스 라운지(EB 완료)",
  "230711 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL",
  "230720 청담동 오피스 라운지 MEDIA ART INSTALLATION PROPOSAL"
];

console.log("=== Notion search verification ===");
console.log("keywords:", keywords);
console.log("queryContext:", queryContext);
console.log("NOTION_TOKEN set:", Boolean(process.env.NOTION_TOKEN));

const outcome = await searchNotionPages(keywords, queryContext);

console.log("\n--- Outcome ---");
console.log("status:", outcome.status);
console.log("rounds:", outcome.rounds);
console.log("queries:", outcome.queries);
console.log("source count:", outcome.sources.length);
if (outcome.error) console.log("error:", outcome.error);
if (outcome.httpStatus) console.log("httpStatus:", outcome.httpStatus);

console.log("\n--- Page titles ---");
for (const s of outcome.sources) {
  console.log("-", s.title, "|", s.url);
}

let failed = false;

if (outcome.status !== "ok") {
  console.error("\nFAIL: expected status 'ok', got", outcome.status);
  failed = true;
}

if (outcome.sources.length !== EXPECTED_TITLES.length) {
  console.error(
    `\nFAIL: expected ${EXPECTED_TITLES.length} sources, got ${outcome.sources.length}`
  );
  failed = true;
}

for (let i = 0; i < EXPECTED_TITLES.length; i++) {
  const expected = EXPECTED_TITLES[i];
  const actual = outcome.sources[i]?.title;
  if (actual !== expected) {
    console.error(`\nFAIL: title[${i}] expected "${expected}", got "${actual ?? "(missing)"}"`);
    failed = true;
  }
}

for (const s of outcome.sources) {
  if (!s.id) {
    console.error("\nFAIL: source missing id:", s.url);
    failed = true;
  }
  if (s.url.includes("/p/") && /\/p\/[a-z0-9-]+$/i.test(s.url) === false) {
    // url should be used as-is from API; just log for inspection
  }
}

if (failed) {
  process.exit(1);
}

console.log("\nPASS: all titles match expected Korean page titles");
