/**
 * 모드 A 검색 검증 시범 (기본 20문서).
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-probe-mode-a-once.ts
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-probe-mode-a-once.ts --pages=20
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient } from "@supabase/supabase-js";
import { runProbeAnswerKey } from "../lib/luna/probe-retrieval";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function pagesArg(): number {
  const raw = process.argv.find((a) => a.startsWith("--pages="));
  if (!raw) return 20;
  const n = Number(raw.slice("--pages=".length));
  return Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : 20;
}

async function main() {
  const pages = pagesArg();
  const admin = adminClient();
  console.log(`[probe-mode-a] pages=${pages}`);
  const started = Date.now();
  const out = await runProbeAnswerKey(admin, { pageLimit: pages });
  const ms = Date.now() - started;
  const r = out.result;
  console.log(
    JSON.stringify(
      {
        mode: r.mode,
        pages_sampled: r.pages_sampled,
        probed: r.probed,
        hit_at_1: r.hit_at_1,
        hit_at_5: r.hit_at_5,
        hit_at_10: r.hit_at_10,
        miss: r.miss,
        miss_by_cause: r.miss_by_cause,
        llm_calls: out.llm_calls,
        cost_usd: out.cost_usd,
        duration_sec: Math.round(ms / 1000),
        learned: r.learned,
        next: r.next,
        miss_samples: (r.misses ?? []).slice(0, 5).map((m) => ({
          title: m.title,
          question: m.question,
          cause: m.cause_kind,
          label: m.cause_guess
        }))
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
