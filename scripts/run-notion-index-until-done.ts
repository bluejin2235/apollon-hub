/**
 * 로컬 증분 색인을 끝날 때까지 청크 반복.
 *   npx tsx scripts/run-notion-index-until-done.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { runNotionIndexChunk } from "../lib/luna/notion-index-runner";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env missing");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const t0 = Date.now();
  let continueRunId: string | undefined;
  for (let i = 0; i < 40; i += 1) {
    const result = await runNotionIndexChunk(admin, {
      mode: "incremental",
      triggeredBy: "manual",
      continueRunId,
      budgetMs: 240_000
    });
    continueRunId = result.run.id;
    console.log(
      `[chunk ${i + 1}] done=${result.done} continued=${result.continued} status=${result.run.status} processed=${result.run.pages_processed}/${result.run.pages_total} skipped=${result.run.pages_skipped} embeds=${result.run.embeddings_added} err=${result.run.error_message ?? ""}`
    );
    if (result.run.status === "failed") process.exit(1);
    if (result.done) {
      console.log(`elapsed_sec=${((Date.now() - t0) / 1000).toFixed(1)}`);
      return;
    }
  }
  console.error("stopped after 40 chunks");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
