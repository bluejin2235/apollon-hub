/**
 * 청크 본문은 유지하고, 임베딩만 계층(path_titles 상위 2단)을 앞에 붙여 재생성.
 *
 *   npx tsx scripts/reembed-notion-chunks.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { contentHash, embeddingToSql } from "@/lib/luna/embedding";
import {
  chunk,
  createEmbeddingsBatch,
  estimateEmbeddingCostUsd
} from "@/lib/luna/notion-index";
import { formatNotionChunkEmbedText } from "@/lib/luna/notion-chunk";

type ChunkRow = {
  chunk_id: string;
  page_id: string;
  text: string;
};

function asPathTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE URL/KEY 필요");
  if (!process.env.LUNA_OPENAI_API_KEY?.trim()) {
    throw new Error("LUNA_OPENAI_API_KEY 필요");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const pathByPage = new Map<string, string[]>();
  {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("luna_notion_pages")
        .select("page_id, path_titles")
        .order("page_id")
        .range(from, from + 999);
      if (error) throw error;
      const rows = data ?? [];
      for (const r of rows) {
        pathByPage.set(String(r.page_id), asPathTitles(r.path_titles));
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  const chunks: ChunkRow[] = [];
  {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("luna_notion_chunks")
        .select("chunk_id, page_id, text")
        .order("chunk_id")
        .range(from, from + 999);
      if (error) throw error;
      const rows = (data ?? []) as ChunkRow[];
      chunks.push(...rows);
      if (rows.length < 1000) break;
      from += 1000;
      if (from % 5000 === 0) console.log(`loaded chunks ${from}`);
    }
  }

  console.log(`[reembed] chunks=${chunks.length} pages_with_path=${pathByPage.size}`);

  let created = 0;
  let tokens = 0;
  const started = Date.now();
  const EMBED_BATCH = 40;
  const UPSERT_BATCH = 20;

  for (const part of chunk(chunks, EMBED_BATCH)) {
    const prepared = part.map((c) => {
      const embedText = formatNotionChunkEmbedText(
        pathByPage.get(c.page_id) ?? [],
        c.text
      );
      return {
        ...c,
        embedText,
        embedHash: contentHash(embedText)
      };
    });

    const { vectors, tokens: batchTokens } = await createEmbeddingsBatch(
      prepared.map((c) => c.embedText)
    );
    tokens += batchTokens;
    const now = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < prepared.length; i += 1) {
      const vec = vectors[i];
      const c = prepared[i]!;
      if (!vec) continue;
      rows.push({
        chunk_id: c.chunk_id,
        page_id: c.page_id,
        content_hash: c.embedHash,
        embedding: embeddingToSql(vec),
        updated_at: now
      });
    }
    for (const batch of chunk(rows, UPSERT_BATCH)) {
      if (batch.length === 0) continue;
      let attempt = 0;
      while (true) {
        attempt += 1;
        const { error } = await admin
          .from("luna_notion_chunk_embeddings")
          .upsert(batch, { onConflict: "chunk_id" });
        if (!error) break;
        if (attempt >= 4 || !/timeout|canceling statement/i.test(error.message)) {
          throw new Error(error.message);
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
      created += batch.length;
    }
    console.log(
      `progress created=${created} tokens=${tokens} / ${chunks.length}`
    );
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log("=== reembed done ===");
  console.log({
    created,
    tokens,
    cost_usd: estimateEmbeddingCostUsd(tokens),
    elapsed_sec: elapsed
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
