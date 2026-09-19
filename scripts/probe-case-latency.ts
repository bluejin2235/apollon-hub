/**
 * 사례·다섯 질문 응답 시간 — 검색 + A등급 스트림(reasoning none) 실측
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-case-latency.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "../lib/luna/embedding";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { takeTopNotionSourcesForLlm } from "../lib/luna/source-pack";
import { formatNotionSourcesForPrompt } from "../lib/luna/notion";
import {
  answerMaxTokensForDepth,
  classifyQuestionDepth,
  llmInjectLimitsForQuestion
} from "../lib/luna/question-depth";
import {
  isListingQuestion,
  listingAnswerRuleWithWikiCount
} from "../lib/luna/listing-question";
import { getTierModel, resolveProviderModel } from "../lib/luna/engine";
import { llmStreamText } from "../lib/luna/llm/client";
import { hasImageSearchIntent } from "../lib/luna/media-index-search";
import { resolveSearchScopeKind } from "../lib/luna/search-scope";
import { WORK_STAGE_ANSWER_RULE } from "../lib/luna/project-stage";
import { writeFileSync } from "node:fs";

const QUESTIONS = [
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "인스파이어 시즌4 어떻게 돼가?",
  "상지원 상무가 얘기한 내용",
  "우리가 한 미디어파사드 사례 보여줘"
];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function probeOne(
  admin: ReturnType<typeof adminClient>,
  question: string
) {
  const totalStarted = Date.now();
  const depth = classifyQuestionDepth(question);
  const listing = isListingQuestion(question);
  const imagePrimary =
    hasImageSearchIntent(question) ||
    resolveSearchScopeKind({ types: [], question }) === "reference";
  const { limits } = llmInjectLimitsForQuestion(question, { imagePrimary });

  const embStarted = Date.now();
  const queryEmbedding = await createQueryEmbedding(question, {
    timeoutMs: 8_000
  });
  const embed_ms = Date.now() - embStarted;

  const outcome = await searchNotionForLuna(
    admin,
    question.slice(0, 80),
    question,
    {
      queryEmbedding,
      skipLive: listing,
      listing
    }
  );
  const search_ms = outcome.timings?.search_ms ?? 0;
  const link_ms = outcome.secondary?.link_ms ?? 0;

  const forLlm = takeTopNotionSourcesForLlm(outcome.sources, limits.notion);
  const context = formatNotionSourcesForPrompt(forLlm, {
    compact: listing
  });
  const listingRule = listing
    ? listingAnswerRuleWithWikiCount(0, forLlm.length)
    : "";
  const system = [
    "당신은 아폴론 루나입니다. 주어진 자료만 바탕으로 한국어로 답하세요.",
    WORK_STAGE_ANSWER_RULE,
    listingRule,
    context
      ? `[노션 검색 결과]\n${context}\n(조건에 맞는 것만 번호로 나열. URL 포함. 제안 단계는 본문에서 빼고 마지막에 제외 이유를 쓴다.)`
      : "[노션 검색] 결과 없음"
  ]
    .filter(Boolean)
    .join("\n\n");

  const tierA = resolveProviderModel(await getTierModel(admin, "A"));
  const maxTokens = answerMaxTokensForDepth(depth, false);
  const llmStarted = Date.now();
  let firstTokenAt: number | null = null;
  let text = "";
  let usage = {
    input_tokens: 0,
    output_tokens: 0
  };
  for await (const chunk of llmStreamText({
    provider: tierA.provider,
    model_id: tierA.model_id,
    system,
    user: question,
    maxTokens
  })) {
    if (chunk.delta) {
      if (firstTokenAt == null) firstTokenAt = Date.now();
      text += chunk.delta;
    }
    if (chunk.usage) {
      usage = {
        input_tokens: chunk.usage.input_tokens,
        output_tokens: chunk.usage.output_tokens
      };
    }
  }
  const llm_ms = Date.now() - llmStarted;
  const first_token_ms =
    firstTokenAt != null ? firstTokenAt - llmStarted : null;
  const total_ms = Date.now() - totalStarted;

  return {
    question,
    depth,
    listing,
    imagePrimary,
    notion_used: forLlm.length,
    embed_ms,
    search_ms,
    link_ms,
    llm_ms,
    first_token_ms,
    total_ms,
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    maxTokens,
    answer: text.trim()
  };
}

async function main() {
  const admin = adminClient();
  const rows = [];
  for (const q of QUESTIONS) {
    process.stdout.write(`\n>>> ${q}\n`);
    const row = await probeOne(admin, q);
    rows.push(row);
    console.log(
      JSON.stringify(
        {
          depth: row.depth,
          embed_ms: row.embed_ms,
          search_ms: row.search_ms,
          link_ms: row.link_ms,
          first_token_ms: row.first_token_ms,
          llm_ms: row.llm_ms,
          total_ms: row.total_ms,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          notion_used: row.notion_used,
          maxTokens: row.maxTokens,
          answer_preview: row.answer.slice(0, 400)
        },
        null,
        2
      )
    );
  }
  console.log("\n=== SUMMARY ===");
  console.log(
    "| 질문 | depth | embed | search | link | TTFT | llm | total | in | out |"
  );
  for (const r of rows) {
    console.log(
      `| ${r.question.slice(0, 18)} | ${r.depth} | ${r.embed_ms} | ${r.search_ms} | ${r.link_ms} | ${r.first_token_ms ?? "-"} | ${r.llm_ms} | ${r.total_ms} | ${r.prompt_tokens} | ${r.completion_tokens} |`
    );
  }
  const caseRow = rows.find((r) => r.question.includes("미디어파사드"));
  if (caseRow) {
    console.log("\n=== CASE ANSWER ===\n");
    console.log(caseRow.answer);
    writeFileSync(
      resolve(process.cwd(), "tmp", "case-answer-after.txt"),
      caseRow.answer,
      "utf8"
    );
  }
  writeFileSync(
    resolve(process.cwd(), "tmp", "probe-case-latency-summary.json"),
    JSON.stringify(
      rows.map((r) => ({
        question: r.question,
        depth: r.depth,
        embed_ms: r.embed_ms,
        search_ms: r.search_ms,
        link_ms: r.link_ms,
        first_token_ms: r.first_token_ms,
        llm_ms: r.llm_ms,
        total_ms: r.total_ms,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        notion_used: r.notion_used
      })),
      null,
      2
    ),
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
