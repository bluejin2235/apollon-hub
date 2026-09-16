/**
 * 모드 A 시험: 노션 문서 20 × 질문 3 = 60문항
 * NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/probe-retrieval-exam.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { runProbeAnswerKey } from "@/lib/luna/probe-retrieval";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("[probe] Mode A exam: 20 pages × 3 questions");
  const started = Date.now();
  const out = await runProbeAnswerKey(admin, {
    pageLimit: 20,
    questionsPerPage: 3
  });
  const ms = Date.now() - started;
  const r = out.result;

  console.log(
    JSON.stringify(
      {
        pages_sampled: r.pages_sampled,
        probed: r.probed,
        hit_at_1: r.hit_at_1,
        hit_at_5: r.hit_at_5,
        hit_at_10: r.hit_at_10,
        miss: r.miss,
        miss_rate: r.miss_rate,
        llm_calls: out.llm_calls,
        cost_usd: out.cost_usd,
        elapsed_ms: ms,
        learned: r.learned
      },
      null,
      2
    )
  );

  const misses = r.misses ?? [];
  console.log(`[misses] ${misses.length}`);
  for (const m of misses.slice(0, 25)) {
    console.log(
      JSON.stringify({
        question: m.question,
        title: m.title,
        rank: m.rank,
        cause_guess: m.cause_guess,
        top: m.top.slice(0, 3).map((t) => t.title)
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
