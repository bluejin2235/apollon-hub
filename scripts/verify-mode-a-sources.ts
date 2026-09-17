/**
 * 모드 A 원천 시험 — 용어 50 · 이미지 100 (LLM 없음, 메일/아젠다 변경 없음)
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-mode-a-sources.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  runProbeGlossary,
  runProbeImage,
  sampleWorkProbeTargets
} from "../lib/luna/probe-mode-a-sources";

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
  const streaks: Record<string, number> = {};

  console.log("=== 용어사전 50 ===");
  const gloss = await runProbeGlossary(admin, { limit: 50, streaks });
  console.log(
    JSON.stringify(
      {
        probed: gloss.probed,
        hit: gloss.hit,
        miss: gloss.miss,
        duration_ms: gloss.duration_ms,
        cost_usd: gloss.cost_usd,
        misses: gloss.items
          .filter((i) => i.bucket === "miss")
          .map((i) => ({
            term: i.title,
            question: i.question,
            cause: i.cause_guess
          }))
      },
      null,
      2
    )
  );

  console.log("=== 이미지 100 ===");
  const img = await runProbeImage(admin, { limit: 100, streaks });
  console.log(
    JSON.stringify(
      {
        probed: img.probed,
        hit: img.hit,
        miss: img.miss,
        duration_ms: img.duration_ms,
        cost_usd: img.cost_usd,
        miss_sample: img.items
          .filter((i) => i.bucket === "miss")
          .slice(0, 15)
          .map((i) => ({
            path: i.page_id.slice(-80),
            question: i.question
          }))
      },
      null,
      2
    )
  );

  console.log("=== Work 선별 샘플 ===");
  const work = await sampleWorkProbeTargets(admin, 20);
  const byReason: Record<string, number> = {};
  for (const w of work) {
    byReason[w.reason] = (byReason[w.reason] ?? 0) + 1;
  }
  console.log(JSON.stringify({ sample: work.slice(0, 10), byReason }, null, 2));

  const out = { glossary: gloss, image: img, work_sample: work, byReason };
  writeFileSync(
    resolve(process.cwd(), "tmp-mode-a-sources-verify.json"),
    JSON.stringify(out, null, 2),
    "utf8"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
