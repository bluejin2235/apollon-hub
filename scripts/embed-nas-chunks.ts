import { parseNasEmbeddingArgs } from "@/lib/luna/nas-embedding-options";
/**
 * nas_file_chunks 임베딩 — embedding IS NULL 만.
 * content_hash 가 같은 파일은 추출 단계에서 청크를 유지하므로 여기선 null 만 처리.
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
import { embeddingToSql } from "@/lib/luna/embedding";
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

type ChunkRow = {
  id: string;
  path: string;
  seq: number;
  content: string;
};

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

async function fetchNullEmbeddingChunks(
  admin: SupabaseClient,
  limit: number | null
): Promise<ChunkRow[]> {
  const out: ChunkRow[] = [];
  const page = 500;
  let from = 0;
  while (true) {
    const take = limit != null ? Math.min(page, limit - out.length) : page;
    if (take <= 0) break;
    const { data, error } = await admin
      .from("nas_file_chunks")
      .select("id, path, seq, content")
      .is("embedding", null)
      .order("path")
      .order("seq")
      .range(from, from + take - 1);
    if (error) throw error;
    const rows = (data ?? []) as ChunkRow[];
    out.push(...rows);
    if (rows.length < take) break;
    if (limit != null && out.length >= limit) break;
    from += take;
  }
  return limit != null ? out.slice(0, limit) : out;
}

async function main() {
  const args = parseNasEmbeddingArgs(process.argv.slice(2));
  const admin = createAdmin();

  const pending = await fetchNullEmbeddingChunks(admin, args.limit);
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
  const pathsTouched = new Set<string>();

  try {
    for (const batch of plan.batches) {
      const part = pending.slice(batch.start, batch.start + batch.input.length);
      const { vectors, tokens: batchTokens } = await createBoundedEmbeddingsBatch(batch.input);
      tokens += batchTokens;
      progress.costUsd = embeddingCostUsd(tokens);

      for (let i = 0; i < part.length; i++) {
        const row = part[i]!;
        const vec = vectors[i];
        progress.lastPath = row.path;
        if (!vec) {
          progress.failed += 1;
          continue;
        }
        const { data: updated, error } = await admin
          .from("nas_file_chunks")
          .update({ embedding: embeddingToSql(vec) })
          .eq("id", row.id)
          .eq("content", row.content)
          .is("embedding", null)
          .select("id");
        if (error) {
          progress.failed += 1;
          console.warn("embed update", row.id, error.message);
          continue;
        }
        if (!updated?.length) {
          progress.skipped += 1; // Changed, deleted, or embedded by another worker.
          continue;
        }
        progress.embeddingsCreated += 1;
        pathsTouched.add(row.path);
      }

      if (runId) await updateNasTextRunProgress(admin, runId, progress);
      console.log(
        `embedded=${progress.embeddingsCreated}/${pending.length} fail=${progress.failed} $${progress.costUsd.toFixed(4)}`
      );
    }

    // 파일별 남은 null 임베딩이 없으면 indexed_at 갱신
    for (const path of pathsTouched) {
      const { count, error } = await admin
        .from("nas_file_chunks")
        .select("id", { count: "exact", head: true })
        .eq("path", path)
        .is("embedding", null);
      if (error) throw error;
      if (count === 0) {
        const { error: completionError } = await admin
          .from("nas_file_text")
          .update({
            indexed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("path", path);
        if (completionError) throw completionError;
      }
    }

    progress.ok = progress.embeddingsCreated;
    if (progress.failed > 0) throw new Error(`${progress.failed} embedding rows failed`);
    if (runId) await finishNasTextRun(admin, runId, "done", progress);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) await finishNasTextRun(admin, runId, "failed", progress, msg);
    throw e;
  }

  console.log("=== embed done ===", {
    embeddings: progress.embeddingsCreated,
    failed: progress.failed,
    tokens,
    cost_usd: progress.costUsd,
    elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1)
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
