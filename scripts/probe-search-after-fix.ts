/**
 * 검색 경로 재측정 — searchNotionForLuna + 단계 분해
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-search-after-fix.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding, embeddingToSql } from "../lib/luna/embedding";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import { lunaLlmComplete } from "../lib/luna/llm/client";
import { takeTopNotionSourcesForLlm } from "../lib/luna/source-pack";
import { formatNotionSourcesForPrompt } from "../lib/luna/notion";
import { formatSeconds } from "../lib/luna/response-timings";

const QUESTIONS = [
  "인스파이어 시즌4 어떻게 돼가?",
  "성수동2가 자료 보여줘",
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "미디어파사드 사례 보여줘"
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const results = [];
  for (const q of QUESTIONS) {
    const total0 = Date.now();
    const emb0 = Date.now();
    const emb = await createQueryEmbedding(q, { timeoutMs: 8_000 });
    const embed_ms = Date.now() - emb0;

    const search0 = Date.now();
    const outcome = await searchNotionForLuna(
      admin,
      q.slice(0, 80),
      q,
      { queryEmbedding: emb, skipLive: true }
    );
    const search_wall = Date.now() - search0;

    const forLlm = takeTopNotionSourcesForLlm(outcome.sources, 8);
    const ctx = formatNotionSourcesForPrompt(forLlm).slice(0, 6000);
    const llm0 = Date.now();
    const llm = await lunaLlmComplete(admin, {
      tier: "A",
      feature: "chat_answer",
      system:
        "당신은 아폴론 루나입니다. 자료만 보고 한국어로 짧게 답하세요.",
      user: `질문: ${q}\n\n자료:\n${ctx || "(없음)"}`,
      maxTokens: 512
    });
    const llm_ms = Date.now() - llm0;
    const total_ms = Date.now() - total0;

    const row = {
      question: q,
      embed_ms,
      search_wall_ms: search_wall,
      search_ms: outcome.timings?.search_ms ?? search_wall,
      link_ms: outcome.secondary?.link_ms ?? 0,
      llm_ms,
      total_ms,
      candidates_found: outcome.timings?.candidates_found ?? 0,
      candidates_added: outcome.secondary?.link_added ?? 0,
      sources: outcome.sources.length,
      rpc_failed_hint: outcome.status
    };
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  console.log("\n=== summary ===");
  for (const r of results) {
    console.log(
      `${r.question}\n  total ${formatSeconds(r.total_ms)} · embed ${formatSeconds(r.embed_ms)} · search ${formatSeconds(r.search_ms)} · link ${formatSeconds(r.link_ms)} · llm ${formatSeconds(r.llm_ms)}`
    );
  }
  const avg = (k: keyof (typeof results)[0]) =>
    Math.round(
      results.reduce((s, r) => s + Number(r[k] || 0), 0) / results.length
    );
  console.log(
    `\navg total ${formatSeconds(avg("total_ms"))} · search ${formatSeconds(avg("search_ms"))} · link ${formatSeconds(avg("link_ms"))} · llm ${formatSeconds(avg("llm_ms"))}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
