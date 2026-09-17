/**
 * 범위+규칙 classify 생략 후 5문항 재측정 (self-score 제외 — 순수 응답 경로).
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-search-scope.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { runLunaTurn } from "../lib/luna/run-chat";
import { inferRuleClassification } from "../lib/luna/search-scope";
import { formatSeconds } from "../lib/luna/response-timings";

const QUESTIONS = [
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "인스파이어 시즌4 어떻게 돼가?",
  "상지원 상무가 얘기한 내용",
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

async function main() {
  const admin = adminClient();
  const rows = [];

  for (const q of QUESTIONS) {
    console.log(`\n=== ${q} ===`);
    const rule = inferRuleClassification(q);
    const t0 = Date.now();
    const turn = await runLunaTurn(admin, q, {});
    const total_ms = Date.now() - t0;
    const row = {
      question: q,
      rule: rule?.kind ?? null,
      total_ms,
      total: formatSeconds(total_ms),
      durationMs: turn.durationMs,
      stages: turn.stageMs ?? {},
      docs: {
        wiki: turn.wikiSources?.length ?? 0,
        notion: turn.notionSources?.length ?? 0,
        cards: turn.sources?.length ?? 0,
        terms: turn.injected_terms?.length ?? 0
      },
      answer: turn.answer.replace(/\s+/g, " ").slice(0, 120)
    };
    rows.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  console.log("\n=== summary ===");
  for (const r of rows) {
    const s = r.stages as Record<string, number>;
    console.log(
      `${r.question}\n  ${r.total} · wiki ${r.docs.wiki} · notion ${r.docs.notion} · cards ${r.docs.cards} · rule=${r.rule}`
    );
    console.log(
      `  classify ${formatSeconds(s.classify ?? 0)} · embed ${formatSeconds(s.embed_and_match ?? 0)} · search ${formatSeconds(s.connector_search ?? 0)} · nas ${formatSeconds(s.nas_explore ?? 0)} · answer_llm ${formatSeconds(s.answer_llm ?? 0)} · load ${formatSeconds((s.load_prompts ?? 0) + (s.load_types_wiki ?? 0) + (s.load_learnings ?? 0) + (s.load_glossary ?? 0))}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
