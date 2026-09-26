import { parseNasEmbeddingArgs } from "@/lib/luna/nas-embedding-options";
/**
 * Current, complete NAS source chunks only. Queue and storage RPCs require
 * the validated-queue migration. No direct-write fallback or paid retries.
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/embed-nas-chunks.ts
 *   npx tsx ... scripts/embed-nas-chunks.ts --limit=500          # read-only
 *   npx tsx ... scripts/embed-nas-chunks.ts --limit=500 --apply  # bounded writes
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeNasError } from "@/lib/luna/nas-error";
import { withNasEmbeddingGate } from "@/lib/luna/nas-embedding-gate";
import { selectNasEmbeddingQueue, revalidateNasEmbeddingBatch, storeNasEmbeddingBatch } from "@/lib/luna/nas-embedding-queue";
import {
  planEmbeddingRequests,
  createBoundedEmbeddingsBatch,
  embeddingCostUsd
} from "@/lib/luna/bounded-embeddings";
import {
  finishNasTextRun,
  startNasTextRun,
  updateNasTextRunProgress,
  type NasTextRunProgress
} from "@/lib/luna/nas-text-runs";

function createAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function main() {
  const args = parseNasEmbeddingArgs(process.argv.slice(2));
  const admin = createAdmin();

  const pending = await selectNasEmbeddingQueue(admin, args.limit);
  console.log(`pending embeddings=${pending.length} batch=${args.batchSize}`);

  if (pending.length === 0) {
    console.log("nothing to embed");
    return;
  }

  const plan = planEmbeddingRequests(pending.map(row => row.content), args.maxCostUsd, args.batchSize);

  if (!args.apply) {
    console.log(JSON.stringify({ mode: "dry_run", selected_chunks: pending.length,
      selected_characters: pending.reduce((sum, row) => sum + row.content.length, 0),
      limit: args.limit, batch_size: args.batchSize,
      tokens_upper_bound: plan.tokensUpperBound, cost_upper_bound_usd: plan.costUpperBoundUsd,
      budget_usd: plan.maxCostUsd, requests: plan.batches.length,
      note: "No embedding API calls or database writes. Characters are not tokens. Use --apply for a bounded run." }));
    return;
  }

  const summary = await withNasEmbeddingGate(admin, async (payment) => {
    const runId = await startNasTextRun(admin, args.kind, pending.length);
    const progress: NasTextRunProgress = {
      targetCount: pending.length,
      ok: 0,
      empty: 0,
      failed: 0,
      skipped: 0,
      chunksCreated: 0,
      embeddingsCreated: 0,
      costUsd: 0,
      lastPath: null
    };

    let tokens = 0;
    const t0 = Date.now();

    try {
      for (const batch of plan.batches) {
        const selected = pending.slice(batch.start, batch.start + batch.input.length);
        const part = await revalidateNasEmbeddingBatch(admin, selected);
        progress.skipped += selected.length - part.length;
        if (part.length) {
          let requestStarted = false;
          let tokensReceived = false;
          try {
            requestStarted = true;
            payment.pending();
            const result = await createBoundedEmbeddingsBatch(part.map(row => row.content));
            tokens += result.tokens;
            tokensReceived = true;
            progress.costUsd = embeddingCostUsd(tokens);
            const stored = await storeNasEmbeddingBatch(admin, part, result.vectors);
            payment.settled();
            progress.embeddingsCreated += stored;
            progress.ok = progress.embeddingsCreated;
            progress.skipped += part.length - stored;
            progress.lastPath = part[part.length - 1]!.path;
          } catch (error) {
            progress.failed += part.length;
            // A timeout or invalid response may still have been billed. Do not
            // claim zero cost or silently retry a request whose usage is unknown.
            if (requestStarted && !tokensReceived) {
              const note = "Embedding request usage unknown; may be billed; no automatic retry";
              console.warn(note);
              throw new Error(`${note}: ${describeNasError(error)}`);
            }
            throw error;
          }
        }

        if (runId) await updateNasTextRunProgress(admin, runId, progress);
        console.log(
          `embedded=${progress.embeddingsCreated}/${pending.length} fail=${progress.failed} $${progress.costUsd.toFixed(4)}`
        );
      }

      progress.ok = progress.embeddingsCreated;
      if (progress.failed > 0) throw new Error(`${progress.failed} embedding rows failed`);
      if (runId) await finishNasTextRun(admin, runId, "done", progress);
    } catch (e) {
      const msg = describeNasError(e);
      if (runId) await finishNasTextRun(admin, runId, "failed", progress, msg);
      throw e;
    }

    return {
      embeddings: progress.embeddingsCreated,
      failed: progress.failed,
      tokens,
      cost_usd: progress.costUsd,
      elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1)
    };
  });
  console.log("=== embed done ===", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
