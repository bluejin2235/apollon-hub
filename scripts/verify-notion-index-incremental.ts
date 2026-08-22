/**
 * 노션 증분 색인 한 청크 검증 (로컬)
 *   npx tsx scripts/verify-notion-index-incremental.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  getRunningNotionIndex,
  runNotionIndexChunk
} from "../lib/luna/notion-index-runner";
import { NOTION_INDEX_EMBED_BATCH } from "../lib/luna/notion-index";

async function main() {
  console.log("NOTION_INDEX_EMBED_BATCH =", NOTION_INDEX_EMBED_BATCH);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env missing");
  if (!process.env.NOTION_TOKEN && !process.env.NOTION_API_KEY) {
    console.warn("NOTION_TOKEN missing — may fail at fetch");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const running = await getRunningNotionIndex(admin);
  if (running) {
    console.log("already running", running.id, running.status);
    process.exit(1);
  }

  const t0 = Date.now();
  const result = await runNotionIndexChunk(admin, {
    mode: "incremental",
    triggeredBy: "manual"
  });
  const ms = Date.now() - t0;
  console.log({
    done: result.done,
    continued: result.continued,
    status: result.run.status,
    pages_processed: result.run.pages_processed,
    pages_total: result.run.pages_total,
    embeddings_added: result.run.embeddings_added,
    error: result.run.error_message,
    ms
  });
  if (result.run.status === "failed") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
