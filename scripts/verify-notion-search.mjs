import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

const { searchNotionPages } = await import("../lib/luna/notion.ts");

const keywords = "청담 오피스라운지 제안서";
const queryContext = "청담 오피스라운지 제안서 찾아줘";

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