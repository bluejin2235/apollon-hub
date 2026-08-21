/**
 * 답변 길이·깊이 규칙 검증
 *   npx tsx scripts/verify-answer-depth-length.ts
 *
 * 정적: 유형·omit talk.answer·max_tokens·규칙 문구
 * 라이브: 검색 결과 + 깊이 규칙만으로 A등급 답변 생성 (run-chat 우회 — server-only)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  answerMaxTokensForDepth,
  classifyQuestionDepth,
  llmInjectLimitsForQuestion,
  shouldOmitTalkAnswer,
  SYNTHESIS_ANSWER_RULE,
  wikiLimitsForDepth
} from "../lib/luna/question-depth";
import {
  LISTING_ANSWER_RULE,
  listingAnswerRuleWithWikiCount,
  isListingQuestion
} from "../lib/luna/listing-question";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import {
  formatNotionSourcesForPrompt,
  type NotionSource
} from "../lib/luna/notion";
import { takeTopNotionSourcesForLlm } from "../lib/luna/source-pack";
import { loadWikiDocs } from "../lib/wiki/store";
import { matchWikiSections, formatWikiSectionsBlock } from "../lib/luna/wiki-match";
import { splitKeywordQuery } from "../lib/luna/knowledge-match";

const CASES = [
  {
    q: "우리가 한 공개공지 프로젝트들 공통점이 뭐야",
    expect: "synthesis" as const,
    minItems: 4,
    maxSec: 25
  },
  {
    q: "롯데타워 서울스카이 제안 어떻게 했어",
    expect: "synthesis" as const,
    minItems: 3,
    maxSec: 25
  },
  {
    q: "지금 진행 중인 사업개발 건 뭐가 있어",
    expect: "listing" as const,
    minItems: 5,
    maxSec: 25
  },
  {
    q: "볼팍견적이 뭐야",
    expect: "simple" as const,
    minItems: 0,
    maxItems: 6,
    maxSec: 10,
    maxLines: 12
  },
  {
    q: "인스파이어 시즌3 수행계획서 어디 있어",
    expect: "simple" as const,
    minItems: 0,
    maxItems: 6,
    maxSec: 10,
    maxLines: 12
  }
];

const SHORT_CHAT_RULE = `[채팅형 답변]
- 기본은 3~6줄. 필요할 때만 길게 쓴다.
- 사례는 최대 2~3개.
- 목록 재나열이 아니라 의견과 판단을 담는다.
- 사람이 더 알고 싶으면 되묻는다. 미리 다 설명하지 않는다.`;

function countAnswerItems(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[·•\-*]\s+\S/.test(line)) n += 1;
    else if (/^\s*\d+[.)]\s+\S/.test(line)) n += 1;
  }
  return n;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function buildDepthSystem(
  depth: ReturnType<typeof classifyQuestionDepth>,
  notion: NotionSource[],
  wikiBlock: string
): string {
  const { limits } = llmInjectLimitsForQuestion(
    depth === "listing"
      ? "뭐가 있어"
      : depth === "synthesis"
        ? "공통점"
        : "어디 있어"
  );
  // limits from actual question below — caller passes depth from real q
  void limits;
  const parts: string[] = [];
  if (depth === "simple") parts.push(SHORT_CHAT_RULE);
  else if (depth === "synthesis") parts.push(SYNTHESIS_ANSWER_RULE);
  else parts.push(LISTING_ANSWER_RULE);

  if (wikiBlock.trim()) parts.push(wikiBlock.trim());
  if (notion.length > 0) {
    const top = takeTopNotionSourcesForLlm(
      notion,
      depth === "simple" ? 3 : depth === "synthesis" ? 8 : 12
    );
    const hint =
      depth === "simple"
        ? "(목록을 다시 나열하지 마라.)"
        : `(위 ${top.length}건을 빠짐없이 다룬다.)`;
    parts.push(
      `[노션 검색 결과]\n${formatNotionSourcesForPrompt(top)}\n${hint}`
    );
  }
  return parts.join("\n\n");
}

async function main() {
  console.log("| 질문 | 유형 | omitTalk | maxTokens |");
  console.log("|------|------|----------|-----------|");
  for (const c of CASES) {
    const depth = classifyQuestionDepth(c.q);
    assert(depth === c.expect, `${c.q} → ${depth} want ${c.expect}`);
    const omit = shouldOmitTalkAnswer(depth);
    const tok = answerMaxTokensForDepth(depth, false);
    if (depth === "simple") {
      assert(!omit && tok === 1024, "simple tokens/omit");
    } else {
      assert(omit && tok === 8192, `${depth} tokens/omit`);
    }
    console.log(
      `| ${c.q.slice(0, 32)} | ${depth} | ${omit} | ${tok} |`
    );
  }
  assert(SYNTHESIS_ANSWER_RULE.includes("빠짐없이"), "synthesis rule");
  assert(
    listingAnswerRuleWithWikiCount(3, 5).includes("노션"),
    "listing extras"
  );
  console.log("OK static\n");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !key || !anthropicKey) {
    console.log("skip live (missing env)");
    return;
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const client = new Anthropic({ apiKey: anthropicKey });
  const wikiLoaded = await loadWikiDocs(admin, { activeOnly: true });

  console.log("| 질문 | 유형 | 초 | 항목 | 줄 | 판정 |");
  console.log("|------|------|----:|-----:|----:|------|");

  const fails: string[] = [];
  for (const c of CASES) {
    const depth = classifyQuestionDepth(c.q);
    const { limits } = llmInjectLimitsForQuestion(c.q);
    const t0 = Date.now();

    const notionOutcome = await searchNotionForLuna(admin, c.q, c.q, {
      skipLive: true,
      listing: isListingQuestion(c.q)
    });
    const kws = splitKeywordQuery(c.q, c.q, []);
    const wikiHits = matchWikiSections(
      wikiLoaded.items,
      kws,
      c.q,
      wikiLimitsForDepth(depth)
    );
    const wikiBlock = formatWikiSectionsBlock(wikiHits);
    const system = buildDepthSystem(depth, notionOutcome.sources, wikiBlock);
    // fix limits from real question
    void limits;

    const maxTokens = answerMaxTokensForDepth(depth, false);
    const res = await client.messages.create({
      model: process.env.LUNA_MODEL || "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: c.q }]
    });
    const answer =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const sec = (Date.now() - t0) / 1000;
    const items = countAnswerItems(answer);
    const lines = answer.split(/\n/).filter((l) => l.trim()).length;

    let ok = sec <= c.maxSec + 5;
    if (c.minItems > 0) ok = ok && items >= c.minItems;
    if (typeof c.maxItems === "number") ok = ok && items <= c.maxItems;
    if (typeof c.maxLines === "number") ok = ok && lines <= c.maxLines;

    console.log(
      `| ${c.q.slice(0, 28)} | ${depth} | ${sec.toFixed(1)} | ${items} | ${lines} | ${ok ? "OK" : "FAIL"} |`
    );
    console.log("  →", answer.slice(0, 140).replace(/\n/g, " / "));
    if (!ok) fails.push(`${c.q} ${sec.toFixed(1)}s items=${items} lines=${lines}`);
  }

  if (fails.length) throw new Error(`failed:\n${fails.join("\n")}`);
  console.log("\nOK all live checks");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
