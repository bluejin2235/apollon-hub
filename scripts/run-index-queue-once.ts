/**
 * 오래된 노션 색인을 대기열에 넣고 최대 200건 강제 재색인.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-index-queue-once.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient } from "@supabase/supabase-js";
import {
  countIndexQueue,
  enqueueNotionRefresh,
  INDEX_QUEUE_DRAIN_MAX,
  recordIndexQueueStudyResult
} from "../lib/luna/index-queue";
import { drainIndexQueue } from "../lib/luna/notion-index-runner";

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

async function main() {
  const admin = adminClient();
  console.log("[index-queue] enqueue stale + properties_null");
  const queued = await enqueueNotionRefresh({
    admin,
    queuedBy: "manual"
  });
  const afterEnqueue = await countIndexQueue(admin);
  console.log(
    JSON.stringify(
      {
        inserted: queued.inserted,
        skipped_already: queued.skipped,
        stale_found: queued.staleFound,
        null_props_found: queued.nullPropsFound,
        pending: afterEnqueue.pending,
        sample: queued.sample.slice(0, 5)
      },
      null,
      2
    )
  );

  console.log(
    `[index-queue] drain max=${INDEX_QUEUE_DRAIN_MAX} (force re-read)`
  );
  const drain = await drainIndexQueue(admin, {
    max: INDEX_QUEUE_DRAIN_MAX,
    budgetMs: 90 * 60 * 1000
  });
  await recordIndexQueueStudyResult(admin, drain, {
    queued_inserted: queued.inserted,
    stale_found: queued.staleFound,
    null_props_found: queued.nullPropsFound,
    queued_by: "manual"
  });
  const leftover = await countIndexQueue(admin);
  console.log(
    JSON.stringify(
      {
        processed: drain.processed,
        failed: drain.failed,
        claimed: drain.claimed,
        remaining_pending: leftover.pending,
        duration_sec: Math.round(drain.duration_ms / 1000),
        relations_before: drain.relations_before,
        relations_after: drain.relations_after,
        relations_delta: drain.relations_after - drain.relations_before,
        properties_filled_before: drain.properties_filled_before,
        properties_filled_after: drain.properties_filled_after,
        properties_delta:
          drain.properties_filled_after - drain.properties_filled_before,
        sample_errors: drain.sample_errors
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
