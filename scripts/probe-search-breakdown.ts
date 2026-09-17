/**
 * 조사 전용 — 검색 15초 단계 분해. 프로덕션 코드 수정 없음.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-search-breakdown.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createQueryEmbedding, embeddingToSql } from "../lib/luna/embedding";
import { matchNotionChunksByKeyword } from "../lib/luna/notion-keyword";
import { notionSearchKeywords } from "../lib/luna/notion-keyword";
import {
  matchNotionChunkEmbeddings,
  NOTION_INDEX_MATCH_THRESHOLD
} from "../lib/luna/notion-index-search";

const QUESTIONS = [
  "인스파이어 시즌4 어떻게 돼가?",
  "성수동2가 자료 보여줘",
  "볼팍견적이 뭐야?",
  "병가 며칠 쓸 수 있어?",
  "미디어파사드 사례 보여줘"
];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ label: string; ms: number; ok: boolean; detail: string; value: T }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - t0;
    return { label, ms, ok: true, detail: "", value };
  } catch (err) {
    const ms = Date.now() - t0;
    return {
      label,
      ms,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      value: null as T
    };
  }
}

async function pingDb(admin: SupabaseClient): Promise<number> {
  const t0 = Date.now();
  await admin.from("luna_notion_pages").select("page_id").limit(1);
  return Date.now() - t0;
}

async function probeOne(admin: SupabaseClient, question: string) {
  const total0 = Date.now();
  const steps: Array<{
    label: string;
    ms: number;
    ok: boolean;
    detail: string;
  }> = [];

  const emb = await timed("embed_query", async () =>
    createQueryEmbedding(question, { timeoutMs: 8_000 })
  );
  steps.push({
    label: emb.label,
    ms: emb.ms,
    ok: emb.ok && Boolean(emb.value),
    detail: emb.value ? `dim=${emb.value.length}` : emb.detail || "null"
  });

  const embedding = emb.value;
  const searchKws = notionSearchKeywords(question.slice(0, 80), question);

  // 병렬 시작 시각 — 각각 독립 측정
  const chunkPromise = timed("rpc_match_chunks", async () => {
    if (!embedding) return { hits: null as Awaited<ReturnType<typeof matchNotionChunkEmbeddings>>, err: "no emb" };
    const t0 = Date.now();
    const { data, error } = await admin.rpc("luna_match_notion_chunks", {
      query_embedding: embeddingToSql(embedding),
      match_threshold: NOTION_INDEX_MATCH_THRESHOLD,
      match_count: 36
    });
    const ms = Date.now() - t0;
    if (error) {
      return {
        hits: null,
        err: `${error.code ?? ""} ${error.message}`,
        rpc_wall_ms: ms,
        rows: 0
      };
    }
    return {
      hits: data,
      err: null as string | null,
      rpc_wall_ms: ms,
      rows: (data ?? []).length
    };
  });

  const kwPromise = timed("keyword_search", async () => {
    const hits = await matchNotionChunksByKeyword(admin, searchKws, {
      limit: 36
    });
    return { rows: hits.length, kws: searchKws.slice(0, 8) };
  });

  // 위키/용어/지식은 채팅 경로에서 임베딩 직후 병렬 — 참고용 단독 측정
  const wikiPromise = embedding
    ? timed("rpc_match_wiki", async () => {
        const { data, error } = await admin.rpc("luna_match_wiki_embeddings", {
          query_embedding: embeddingToSql(embedding),
          match_threshold: 0.3,
          match_count: 12
        });
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      })
    : null;
  const glossPromise = embedding
    ? timed("rpc_match_glossary", async () => {
        const { data, error } = await admin.rpc(
          "luna_match_glossary_embeddings",
          {
            query_embedding: embeddingToSql(embedding),
            match_threshold: 0.3,
            match_count: 12
          }
        );
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      })
    : null;
  const learnPromise = embedding
    ? timed("rpc_match_learning", async () => {
        const { data, error } = await admin.rpc(
          "luna_match_learning_embeddings",
          {
            query_embedding: embeddingToSql(embedding),
            match_threshold: 0.3,
            match_count: 12
          }
        );
        if (error) throw new Error(error.message);
        return (data ?? []).length;
      })
    : null;

  const [chunk, kw] = await Promise.all([chunkPromise, kwPromise]);
  const chunkVal = chunk.value as {
    hits: unknown;
    err: string | null;
    rpc_wall_ms?: number;
    rows: number;
  } | null;
  steps.push({
    label: "rpc_match_chunks",
    ms: chunk.ms,
    ok: !chunkVal?.err,
    detail: chunkVal?.err
      ? `TIMEOUT/ERR ${chunkVal.err} wall=${chunkVal.rpc_wall_ms}`
      : `rows=${chunkVal?.rows ?? 0}`
  });
  steps.push({
    label: "keyword_search",
    ms: kw.ms,
    ok: kw.ok,
    detail: `rows=${(kw.value as { rows: number })?.rows ?? 0} kws=${((kw.value as { kws: string[] })?.kws ?? []).join(",")}`
  });

  const parallelWall = Math.max(chunk.ms, kw.ms);

  // 키워드 내부 분해: pages 전체 로드
  const pagesLoad = await timed("kw_load_all_pages", async () => {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title")
      .eq("archived", false)
      .limit(8000);
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  });
  steps.push({
    label: "kw_load_all_pages",
    ms: pagesLoad.ms,
    ok: pagesLoad.ok,
    detail: `rows=${pagesLoad.value ?? 0}`
  });

  if (wikiPromise && glossPromise && learnPromise) {
    const [w, g, l] = await Promise.all([wikiPromise, glossPromise, learnPromise]);
    for (const s of [w, g, l]) {
      steps.push({
        label: s.label,
        ms: s.ms,
        ok: s.ok,
        detail: s.ok ? `rows=${s.value}` : s.detail
      });
    }
  }

  // 단순 select 1건 RTT
  const rtt = await pingDb(admin);
  steps.push({ label: "db_rtt_select1", ms: rtt, ok: true, detail: "" });

  const total_ms = Date.now() - total0;
  const timeout =
    typeof chunkVal?.err === "string" &&
    /57014|timeout|canceling/i.test(chunkVal.err);

  return {
    question,
    total_ms,
    parallel_chunk_kw_wall_ms: parallelWall,
    chunk_timeout: timeout,
    chunk_err: chunkVal?.err ?? null,
    steps
  };
}

async function main() {
  const admin = adminClient();
  const warm = await pingDb(admin);
  console.log(JSON.stringify({ warm_rtt_ms: warm }, null, 2));

  const results = [];
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q} ===`);
    const r = await probeOne(admin, q);
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }

  console.log("\n=== TIMEOUT COUNT ===");
  const timeouts = results.filter((r) => r.chunk_timeout).length;
  console.log(`chunk RPC timeouts: ${timeouts} / ${results.length}`);

  console.log("\n=== STEP AVERAGES (ms) ===");
  const labels = [
    "embed_query",
    "rpc_match_chunks",
    "keyword_search",
    "kw_load_all_pages",
    "rpc_match_wiki",
    "rpc_match_glossary",
    "rpc_match_learning",
    "db_rtt_select1"
  ];
  for (const label of labels) {
    const vals = results
      .map((r) => r.steps.find((s) => s.label === label)?.ms ?? 0)
      .filter((n) => n > 0);
    if (vals.length === 0) {
      console.log(`${label}: (none)`);
      continue;
    }
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const max = Math.max(...vals);
    console.log(
      `${label}: avg ${avg}ms · max ${max}ms · n=${vals.length}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
