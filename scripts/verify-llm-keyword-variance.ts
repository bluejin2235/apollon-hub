/**
 * LLM 검색어 추출 흔들림 확인
 *   npx tsx scripts/verify-llm-keyword-variance.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { notionSearchKeywords } from "../lib/luna/notion-keyword";

const q = "덱스터스튜디오랑 뭘 같이 했었지";

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("skip: no ANTHROPIC_API_KEY");
    return;
  }
  const client = new Anthropic({ apiKey: key });
  const model =
    process.env.LUNA_KEYWORD_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    "claude-haiku-4-5-20251001";
  const system =
    '검색에 쓸 핵심 키워드만 짧게 추출하세요. 조사·어미 없이 명사 위주, 공백 구분.';
  console.log("model", model, "q", q);
  console.log("from question only:", notionSearchKeywords(q, q));
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 64,
        system,
        messages: [{ role: "user", content: q }]
      });
      const text =
        res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
      const kws = notionSearchKeywords(text, q);
      console.log(
        `run ${i}`,
        JSON.stringify({
          llm: text,
          searchKws: kws,
          hasDexter: kws.some((k) => k.includes("덱스터"))
        })
      );
    } catch (e) {
      console.error("run", i, e);
    }
  }
}

main();
