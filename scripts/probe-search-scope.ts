/**
 * 질문 종류별 검색 범위 재측정.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-search-scope.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { runLunaTurn } from "../lib/luna/run-chat";
import { scoreAnswerSelf } from "../lib/luna/answer-self-score";
import { resolveSearchScope } from "../lib/luna/search-scope";
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
    const t0 = Date.now();
    const turn = await runLunaTurn(admin, q, {});
    const total_ms = Date.now() - t0;
    const score = await scoreAnswerSelf(admin, {
      question: q,
      answer: turn.answer
    });
    const scope = resolveSearchScope({
      types: [], // display only — actual scope logged in run-chat
      question: q
    });
    const notionN = turn.notionSources?.length ?? 0;
    const wikiN = turn.wikiSources?.length ?? 0;
    const cardN = turn.sources?.length ?? 0;
    const row = {
      question: q,
      scope_guess: scope.kind,
      total_ms,
      total: formatSeconds(total_ms),
      docs: {
        wiki: wikiN,
        notion: notionN,
        cards: cardN,
        terms: turn.injected_terms?.length ?? 0
      },
      confidence: score?.confidence_score ?? null,
      intent: score?.intent_score ?? null,
      self_note: score?.self_note ?? null,
      answer: turn.answer.replace(/\s+/g, " ").slice(0, 160)
    };
    rows.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  console.log("\n=== summary ===");
  for (const r of rows) {
    console.log(
      `${r.question}\n  ${r.total} · wiki ${r.docs.wiki} · notion ${r.docs.notion} · cards ${r.docs.cards} · 자신감 ${r.confidence ?? "?"}/10 · scope~${r.scope_guess}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
