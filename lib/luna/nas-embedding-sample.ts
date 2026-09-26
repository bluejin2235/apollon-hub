import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentNasBodyFiles } from "@/lib/luna/nas-source-version";
import { createBoundedEmbeddingsBatch, embeddingCostUsd, planEmbeddingRequests } from "@/lib/luna/bounded-embeddings";

type Row = { id: string; path: string; seq: number; content: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const literalLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

export function parseNasSampleArgs(argv: string[]) {
  let term = "", query = "", execute = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else if (arg.startsWith("--term=")) term = arg.slice(7).trim();
    else if (arg.startsWith("--query=")) query = arg.slice(8).trim();
    else throw new Error("Unknown NAS sample argument");
  }
  if (term.length < 2 || term.length > 100 || !query || Buffer.byteLength(query, "utf8") > 2000) {
    throw new Error("Provide --term (2–100 characters) and --query (1–2000 UTF-8 bytes)");
  }
  return { term, query, execute };
}

/** Small, deliberately scoped corpus; never writes vectors, job rows, or metadata.
 * It tests live embedding transport and local ranking, NOT production RPC/UI quality.
 */
export async function runNasEmbeddingSample(
  admin: SupabaseClient,
  options: ReturnType<typeof parseNasSampleArgs>
) {
  // Revalidate options for callers other than the CLI.
  parseNasSampleArgs([`--term=${options.term}`, `--query=${options.query}`]);
  const fetched = await admin.from("nas_file_text").select("path")
    .eq("status", "ok").ilike("path", `%${literalLike(options.term)}%`)
    .order("modified_at", { ascending: false }).order("path").limit(20);
  if (fetched.error) throw new Error("NAS sample candidate read failed");
  const candidates = (fetched.data ?? []) as Array<{ path: string }>;
  const versions = await currentNasBodyFiles(admin, candidates.map(row => row.path));
  const freshPaths = [...new Set(candidates.map(row => row.path))].filter(path => versions.has(path));
  const paths = freshPaths.slice(0, 6);
  // Use the existing (path, seq) index instead of scanning/sorting the chunk corpus.
  const parts = await Promise.all(paths.map(path => admin.from("nas_file_chunks")
    .select("id, path, seq, content").eq("path", path).order("seq").limit(3)));
  if (parts.some(part => part.error)) throw new Error("NAS sample chunk read failed");
  const sampledRows = parts.flatMap(part => (part.data ?? []) as Row[]);
  // pdf-parse page delimiters alone are not source evidence. Keep real text intact.
  const selected = sampledRows.filter(row => row.content.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, "").trim());
  if (!selected.length) throw new Error("No fresh extracted chunks in this bounded path sample");
  // At most 18 source chunks + 1 query, USD 0.01 per invocation.
  const plan = planEmbeddingRequests([options.query, ...selected.map(row => row.content)], 0.01, 100);
  const summary = {
    mode: options.execute ? "memory_only" : "dry_run",
    database_writes: 0,
    candidate_rows: candidates.length,
    selection_order: "modified_at descending, then path",
    metadata_matched_files: freshPaths.length,
    metadata_excluded_files: candidates.length - freshPaths.length,
    marker_only_or_empty_chunks_excluded: sampledRows.length - selected.length,
    candidate_window_full: candidates.length === 20,
    selected_files: new Set(selected.map(row => row.path)).size,
    selected_chunks: selected.length,
    query_sha256: digest(options.query),
    source_manifest_sha256: digest(JSON.stringify(selected.map(row => [row.id, row.seq, digest(row.content), versions.get(row.path)]))),
    tokens_upper_bound: plan.tokensUpperBound,
    cost_upper_bound_usd: plan.costUpperBoundUsd,
    budget_usd: plan.maxCostUsd,
    requests: plan.batches.length,
    limitation: "Path-scoped sample only; not a full-corpus, Supabase RPC, employee UI, or relevance acceptance test."
  };
  if (!options.execute) return summary;
  const vectors: number[][] = [];
  let tokens = 0;
  for (const batch of plan.batches) {
    const result = await createBoundedEmbeddingsBatch(batch.input);
    vectors.push(...result.vectors);
    tokens += result.tokens;
  }
  // Reject a report if the selected text or indexed source version changed mid-run.
  const [after, afterVersions] = await Promise.all([
    admin.from("nas_file_chunks").select("id, path, seq, content").in("id", selected.map(row => row.id)).limit(100),
    currentNasBodyFiles(admin, selected.map(row => row.path))
  ]);
  if (after.error || after.data?.length !== selected.length || selected.some(row => {
    const found = (after.data ?? []).find(candidate => candidate.id === row.id);
    return !found || found.path !== row.path || found.seq !== row.seq || found.content !== row.content ||
      JSON.stringify(versions.get(row.path)) !== JSON.stringify(afterVersions.get(row.path));
  })) throw new Error("NAS sample changed during paid validation; no automatic retry");
  const queryVector = vectors[0]!;
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, n) => sum + n * n, 0));
  const queryNorm = norm(queryVector);
  const ranked = selected.map((row, i) => {
    const vector = vectors[i + 1]!;
    const similarity = vector.reduce((sum, n, j) => sum + n * queryVector[j]!, 0) / (queryNorm * norm(vector));
    return { id: row.id, path_sha256: digest(row.path), seq: row.seq, similarity };
  }).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  return { ...summary, actual_tokens: tokens, cost_usd: embeddingCostUsd(tokens), dimensions: queryVector.length, top: ranked.slice(0, 5) };
}
