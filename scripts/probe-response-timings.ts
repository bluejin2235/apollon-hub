/**
 * 응답 시간 단계별 측정 — 채팅과 같은 검색·연결·LLM 경로를 시험한다.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-response-timings.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "../lib/luna/embedding";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { takeTopNotionSourcesForLlm } from "../lib/luna/source-pack";
import { formatNotionSourcesForPrompt } from "../lib/luna/notion";
import { lunaLlmComplete } from "../lib/luna/llm/client";
import {
  formatSeconds,
  insertResponseTiming
} from "../lib/luna/response-timings";

const QUESTIONS = [
  "인스파이어 시즌4 어떻게 돼가?",
  "성수동2가 자료 보여줘",
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "미디어파사드 사례 보여줘"
];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function probeOne(admin: ReturnType<typeof adminClient>, question: string) {
  const totalStarted = Date.now();

  const embStarted = Date.now();
  const queryEmbedding = await createQueryEmbedding(question, {
    timeoutMs: 8_000
  });
  const embed_ms = Date.now() - embStarted;

  const outcome = await searchNotionForLuna(admin, question.slice(0, 80), question, {
    queryEmbedding,
    skipLive: true
  });

  const search_ms = outcome.timings?.search_ms ?? 0;
  const link_ms = outcome.secondary?.link_ms ?? 0;
  const candidates_found =
    outcome.timings?.candidates_found ?? outcome.sources.length;
  const candidates_added = outcome.secondary?.link_added ?? 0;
  const forLlm = takeTopNotionSourcesForLlm(outcome.sources, 8);
  const candidates_used = forLlm.length;

  const context = formatNotionSourcesForPrompt(forLlm).slice(0, 6000);
  const llmStarted = Date.now();
  const llm = await lunaLlmComplete(admin, {
    tier: "A",
    feature: "chat_answer",
    system:
      "당신은 아폴론 루나입니다. 주어진 자료만 바탕으로 한국어로 짧게 답하세요. 자료가 부족하면 모른다고 하세요.",
    user: `질문: ${question}\n\n자료:\n${context || "(없음)"}`,
    maxTokens: 512
  });
  const llm_ms = Date.now() - llmStarted;
  const total_ms = Date.now() - totalStarted;

  const row = {
    embed_ms,
    search_ms,
    link_ms,
    llm_ms,
    total_ms,
    candidates_found,
    candidates_added,
    candidates_used,
    prompt_tokens: llm.usage.input_tokens,
    completion_tokens: llm.usage.output_tokens,
    model: llm.model_id
  };

  // 프로브도 같은 테이블에 남겨 대시보드·체크가 바로 보이게 한다
  await insertResponseTiming(admin, row);

  return {
    question,
    ...row,
    answer_preview: llm.text.replace(/\s+/g, " ").slice(0, 80)
  };
}

async function main() {
  const admin = adminClient();
  const results = [];
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q} ===`);
    const r = await probeOne(admin, q);
    results.push(r);
    console.log(
      JSON.stringify(
        {
          embed_ms: r.embed_ms,
          search_ms: r.search_ms,
          link_ms: r.link_ms,
          llm_ms: r.llm_ms,
          total_ms: r.total_ms,
          candidates: `${r.candidates_found}+${r.candidates_added}→${r.candidates_used}`,
          model: r.model,
          answer: r.answer_preview
        },
        null,
        2
      )
    );
  }

  console.log("\n=== summary ===");
  for (const r of results) {
    const slowest = (
      [
        ["embed", r.embed_ms],
        ["search", r.search_ms],
        ["link", r.link_ms],
        ["llm", r.llm_ms]
      ] as const
    ).sort((a, b) => b[1] - a[1])[0]!;
    console.log(
      `${r.question}\n  total ${formatSeconds(r.total_ms)} · embed ${formatSeconds(r.embed_ms)} · search ${formatSeconds(r.search_ms)} · link ${formatSeconds(r.link_ms)} · llm ${formatSeconds(r.llm_ms)} · 최장 ${slowest[0]}`
    );
  }

  const avg = (k: keyof (typeof results)[0]) =>
    Math.round(
      results.reduce((s, r) => s + (Number(r[k]) || 0), 0) / results.length
    );
  console.log(
    `\navg total ${formatSeconds(avg("total_ms"))} · search ${formatSeconds(avg("search_ms"))} · link ${formatSeconds(avg("link_ms"))} · llm ${formatSeconds(avg("llm_ms"))}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
