/**
 * 벡터 단독 vs 키워드 단독 비교 (조사/검증용)
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-chunk-alone.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding, embeddingToSql } from "../lib/luna/embedding";
import {
  matchNotionChunksByKeyword,
  notionSearchKeywords
} from "../lib/luna/notion-keyword";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const q = "인스파이어 시즌4 어떻게 돼가?";
  const emb = await createQueryEmbedding(q, { timeoutMs: 8_000 });
  if (!emb) throw new Error("no emb");

  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const { data, error } = await admin.rpc("luna_match_notion_chunks", {
      query_embedding: embeddingToSql(emb),
      match_threshold: 0.3,
      match_count: 36
    });
    console.log(
      JSON.stringify({
        i,
        alone_chunk_ms: Date.now() - t0,
        err: error?.message ?? null,
        code: error?.code ?? null,
        rows: (data ?? []).length
      })
    );
  }

  const t1 = Date.now();
  const kw = await matchNotionChunksByKeyword(
    admin,
    notionSearchKeywords(q.slice(0, 80), q),
    { limit: 36 }
  );
  console.log(
    JSON.stringify({ alone_kw_ms: Date.now() - t1, rows: kw.length })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
