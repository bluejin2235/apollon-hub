import { EMBEDDING_DIMS, EMBEDDING_MODEL } from "@/lib/luna/embedding";
import { openaiApiKey } from "@/lib/luna/env-keys";

// Official text-embedding-3-small standard price, checked 2026-09-26.
// https://developers.openai.com/api/docs/models/text-embedding-3-small
export const EMBEDDING_USD_PER_MILLION = 0.02;
export const MAX_EMBEDDING_RUN_USD = 1;
const MAX_INPUT_BYTES = 8191;
const MAX_REQUEST_BYTES = 200_000;

export function embeddingCostUsd(tokens: number): number {
  return tokens * EMBEDDING_USD_PER_MILLION / 1_000_000;
}

/** UTF-8 bytes conservatively bound byte-BPE tokens; this is NOT a token count.
 * Reject oversized inputs rather than silently embedding a truncated source.
 * Reserve the whole run before its first paid request. No automatic retries.
 */
export function planEmbeddingRequests(texts: string[], maxCostUsd = MAX_EMBEDDING_RUN_USD, batchSize = 100) {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > MAX_EMBEDDING_RUN_USD) {
    throw new Error("Embedding budget must be greater than 0 and at most USD 1");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100 || texts.length > 5000) {
    throw new Error("Embedding run/batch size exceeds its bound");
  }
  const input = texts.map(text => text.replace(/\s+/g, " ").trim());
  const bytes = input.map(text => Buffer.byteLength(text, "utf8"));
  if (bytes.some(n => n === 0 || n > MAX_INPUT_BYTES)) {
    throw new Error("Embedding input is empty or exceeds 8191 UTF-8 bytes; rechunk explicitly");
  }
  const tokensUpperBound = bytes.reduce((sum, n) => sum + n, 0);
  const costUpperBoundUsd = embeddingCostUsd(tokensUpperBound);
  if (costUpperBoundUsd > maxCostUsd) throw new Error("Embedding run exceeds its USD budget before execution");
  const batches: Array<{ start: number; input: string[] }> = [];
  let batchBytes = 0;
  for (let i = 0; i < input.length; i++) {
    let last = batches[batches.length - 1];
    if (!last || last.input.length === batchSize || batchBytes + bytes[i]! > MAX_REQUEST_BYTES) {
      last = { start: i, input: [] };
      batches.push(last);
      batchBytes = 0;
    }
    last.input.push(input[i]!);
    batchBytes += bytes[i]!;
  }
  return { batches, tokensUpperBound, costUpperBoundUsd, maxCostUsd };
}

/** One bounded request. A timeout can still be billed; never retry automatically. */
export async function createBoundedEmbeddingsBatch(texts: string[]) {
  const plan = planEmbeddingRequests(texts);
  if (plan.batches.length !== 1) throw new Error("Expected exactly one bounded embedding batch");
  const key = openaiApiKey();
  if (!key) throw new Error("LUNA_OPENAI_API_KEY / OPENAI_API_KEY required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: plan.batches[0]!.input, encoding_format: "float" })
    });
    // Do not copy provider bodies into logs: they may contain source text.
    if (!response.ok) throw new Error(`Embedding HTTP ${response.status}; no automatic retry`);
    const json = await response.json() as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: { total_tokens?: number };
    };
    const tokens = json.usage?.total_tokens;
    if (!Number.isSafeInteger(tokens) || tokens! < 1 || tokens! > plan.tokensUpperBound) {
      throw new Error("Embedding response has missing or unexpected token usage");
    }
    if (!Array.isArray(json.data) || json.data.length !== texts.length) throw new Error("Incomplete embedding response");
    const vectors: number[][] = new Array(texts.length);
    for (const row of json.data) {
      const i = row.index;
      const vec = row.embedding;
      if (!Number.isInteger(i) || i! < 0 || i! >= texts.length || vectors[i!] ||
          !Array.isArray(vec) || vec.length !== EMBEDDING_DIMS ||
          vec.some(n => typeof n !== "number" || !Number.isFinite(n)) || !vec.some(n => n !== 0) ||
          !Number.isFinite(vec.reduce((sum, n) => sum + n * n, 0))) {
        throw new Error("Embedding response has an invalid index or vector");
      }
      vectors[i!] = vec;
    }
    return { vectors, tokens: tokens! };
  } finally {
    clearTimeout(timer);
  }
}
