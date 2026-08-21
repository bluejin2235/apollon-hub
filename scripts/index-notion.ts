/**
 * 노션 1차 전체 색인. 실행은 블루진.
 *
 *   npx tsx scripts/index-notion.ts
 *
 * 페이지 단위로 저장한다. 끊기면 다시 돌리면 이어진다.
 * 전제: luna_notion_* 테이블 + LUNA_OPENAI_API_KEY + NOTION_TOKEN
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embeddingToSql } from "@/lib/luna/embedding";
import {
  blocksToIndexed,
  buildMetaGraph,
  chunk,
  collectPagesFromSearch,
  createEmbeddingsBatch,
  estimateEmbeddingCostUsd,
  firstNasPath,
  IndexedBlock,
  IndexedPage,
  newScanBatch,
  NotionIndexClient,
  NOTION_INDEX_EMBED_BATCH,
  NOTION_INDEX_INSERT_BATCH,
  NOTION_INDEX_MIN_EMBED_CHARS,
  NOTION_INDEX_VALIDATE_RATIO,
  pageToIndexed
} from "@/lib/luna/notion-index";
import { blocksToChunks, type IndexedChunk } from "@/lib/luna/notion-chunk";

type PageRow = IndexedPage & {
  scan_batch: string;
  indexed_at: string | null;
};

type ExistingPage = {
  last_edited_time: string | null;
  indexed_at: string | null;
};

type BlockRow = IndexedBlock;

type EmbedRow = {
  chunk_id: string;
  page_id: string;
  content_hash: string;
  embedding: string;
  updated_at: string;
};

type Stats = {
  pages: number;
  blocks: number;
  embeddings: number;
  skippedShort: number;
  skippedHash: number;
  skippedUnchanged: number;
  zeroBlockPages: number;
  nasPathPages: number;
  embedTokens: number;
  elapsedSec: number;
  rootStats: Array<{ root_title: string; pages: number; blocks: number }>;
  depthStats: Record<string, number>;
  topPages: Array<{
    title: string;
    root_title: string | null;
    blocks: number;
  }>;
  tableSizes: Record<string, string | number>;
};

function log(msg: string): void {
  console.log(msg);
}

function createAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 필요");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sameEditedTime(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

function logProgress(
  done: number,
  total: number,
  blocks: number,
  embeddings: number
): void {
  log(
    `${done.toLocaleString()} / ${total.toLocaleString()} 페이지 · 블록 ${blocks.toLocaleString()} · 임베딩 ${embeddings.toLocaleString()}`
  );
}

async function upsertBatch(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  for (const part of chunk(rows, NOTION_INDEX_INSERT_BATCH)) {
    const { error } = await admin.from(table).upsert(part, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function getPreviousPageCount(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from("luna_notion_pages")
    .select("*", { count: "exact", head: true });
  if (error) {
    if (String(error.message).includes("does not exist")) return 0;
    throw error;
  }
  return count ?? 0;
}

async function loadExistingPages(
  admin: SupabaseClient
): Promise<Map<string, ExistingPage>> {
  const map = new Map<string, ExistingPage>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, last_edited_time, indexed_at")
      .order("page_id")
      .range(from, from + pageSize - 1);
    if (error) {
      if (String(error.message).includes("does not exist")) return map;
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      map.set(row.page_id as string, {
        last_edited_time:
          typeof row.last_edited_time === "string" ? row.last_edited_time : null,
        indexed_at: typeof row.indexed_at === "string" ? row.indexed_at : null
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

async function countByPage(
  admin: SupabaseClient,
  table: "luna_notion_blocks" | "luna_notion_embeddings" | "luna_notion_chunk_embeddings"
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from(table)
      .select("page_id")
      .order("page_id")
      .range(from, from + pageSize - 1);
    if (error) {
      if (String(error.message).includes("does not exist")) return map;
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      const id = row.page_id as string;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

async function deleteOrphanPages(
  admin: SupabaseClient,
  livePageIds: Set<string>
): Promise<void> {
  const staleIds: string[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id")
      .order("page_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const id = row.page_id as string;
      if (!livePageIds.has(id)) staleIds.push(id);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  if (staleIds.length === 0) return;

  for (const part of chunk(staleIds, NOTION_INDEX_INSERT_BATCH)) {
    const { data: blocks } = await admin
      .from("luna_notion_blocks")
      .select("block_id")
      .in("page_id", part);
    const blockIds = (blocks ?? []).map((b) => b.block_id as string);
    if (blockIds.length > 0) {
      for (const bPart of chunk(blockIds, NOTION_INDEX_INSERT_BATCH)) {
        await admin.from("luna_notion_embeddings").delete().in("block_id", bPart);
      }
      await admin.from("luna_notion_blocks").delete().in("page_id", part);
    }
    await admin.from("luna_notion_chunks").delete().in("page_id", part);
    await admin.from("luna_notion_pages").delete().in("page_id", part);
  }
}

async function deleteStaleBlocksForPage(
  admin: SupabaseClient,
  pageId: string,
  liveBlockIds: Set<string>
): Promise<void> {
  const { data, error } = await admin
    .from("luna_notion_blocks")
    .select("block_id")
    .eq("page_id", pageId);
  if (error) throw error;
  const stale = (data ?? [])
    .map((row) => row.block_id as string)
    .filter((id) => !liveBlockIds.has(id));
  for (const part of chunk(stale, NOTION_INDEX_INSERT_BATCH)) {
    if (part.length === 0) continue;
    await admin.from("luna_notion_embeddings").delete().in("block_id", part);
    await admin.from("luna_notion_blocks").delete().in("block_id", part);
  }
}

async function deleteStaleChunksForPage(
  admin: SupabaseClient,
  pageId: string,
  liveChunkIds: Set<string>
): Promise<void> {
  const { data, error } = await admin
    .from("luna_notion_chunks")
    .select("chunk_id")
    .eq("page_id", pageId);
  if (error) throw error;
  const stale = (data ?? [])
    .map((row) => row.chunk_id as string)
    .filter((id) => !liveChunkIds.has(id));
  for (const part of chunk(stale, NOTION_INDEX_INSERT_BATCH)) {
    if (part.length === 0) continue;
    await admin.from("luna_notion_chunk_embeddings").delete().in("chunk_id", part);
    await admin.from("luna_notion_chunks").delete().in("chunk_id", part);
  }
}

async function loadExistingChunkHashes(
  admin: SupabaseClient,
  chunkIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(chunkIds, NOTION_INDEX_INSERT_BATCH)) {
    if (part.length === 0) continue;
    const { data, error } = await admin
      .from("luna_notion_chunk_embeddings")
      .select("chunk_id, content_hash")
      .in("chunk_id", part);
    if (error) throw error;
    for (const row of data ?? []) {
      map.set(row.chunk_id as string, row.content_hash as string);
    }
  }
  return map;
}

async function fetchTableSizes(admin: SupabaseClient): Promise<Record<string, string | number>> {
  const tables = [
    "luna_notion_pages",
    "luna_notion_blocks",
    "luna_notion_chunks",
    "luna_notion_chunk_embeddings",
    "luna_notion_embeddings"
  ];
  const out: Record<string, string | number> = {};
  for (const table of tables) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });
    out[`${table}_rows`] = error ? `err:${error.message}` : (count ?? 0);
  }
  return out;
}

async function embedAndSaveChunks(
  admin: SupabaseClient,
  chunks: IndexedChunk[]
): Promise<{ created: number; skippedShort: number; skippedHash: number; tokens: number }> {
  const embedCandidates = chunks.filter(
    (c) => c.text.replace(/\s+/g, "").length >= NOTION_INDEX_MIN_EMBED_CHARS
  );
  const skippedShort = chunks.length - embedCandidates.length;
  const existingHashes = await loadExistingChunkHashes(
    admin,
    embedCandidates.map((c) => c.chunk_id)
  );

  const toEmbed: IndexedChunk[] = [];
  let skippedHash = 0;
  for (const c of embedCandidates) {
    if (existingHashes.get(c.chunk_id) === c.content_hash) {
      skippedHash += 1;
      continue;
    }
    toEmbed.push(c);
  }

  let created = 0;
  let tokens = 0;
  for (const batch of chunk(toEmbed, NOTION_INDEX_EMBED_BATCH)) {
    const { vectors, tokens: batchTokens } = await createEmbeddingsBatch(
      batch.map((c) => c.text)
    );
    tokens += batchTokens;
    const now = new Date().toISOString();
    const rows: EmbedRow[] = [];
    batch.forEach((c, idx) => {
      const vector = vectors[idx];
      if (!vector) return;
      rows.push({
        chunk_id: c.chunk_id,
        page_id: c.page_id,
        content_hash: c.content_hash,
        embedding: embeddingToSql(vector),
        updated_at: now
      });
    });
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("luna_notion_chunk_embeddings")
      .upsert(rows, { onConflict: "chunk_id" });
    if (error) throw new Error(`luna_notion_chunk_embeddings upsert: ${error.message}`);
    created += rows.length;
  }

  return { created, skippedShort, skippedHash, tokens };
}

function buildStats(opts: {
  pages: PageRow[];
  blocksByPage: Map<string, number>;
  embedCount: number;
  skippedShort: number;
  skippedHash: number;
  skippedUnchanged: number;
  zeroBlockPages: number;
  nasPathPages: number;
  embedTokens: number;
  elapsedSec: number;
}): Stats {
  const rootMap = new Map<string, { pages: number; blocks: number }>();
  for (const p of opts.pages) {
    const root = p.root_title ?? "(unknown)";
    const cur = rootMap.get(root) ?? { pages: 0, blocks: 0 };
    cur.pages += 1;
    cur.blocks += opts.blocksByPage.get(p.page_id) ?? 0;
    rootMap.set(root, cur);
  }

  const depthStats: Record<string, number> = {};
  for (const p of opts.pages) {
    const key = String(p.depth);
    depthStats[key] = (depthStats[key] ?? 0) + 1;
  }

  const topPages = opts.pages
    .map((p) => ({
      title: p.title,
      root_title: p.root_title,
      blocks: opts.blocksByPage.get(p.page_id) ?? 0
    }))
    .sort((a, b) => b.blocks - a.blocks)
    .slice(0, 20);

  let blockTotal = 0;
  for (const n of opts.blocksByPage.values()) blockTotal += n;

  return {
    pages: opts.pages.length,
    blocks: blockTotal,
    embeddings: opts.embedCount,
    skippedShort: opts.skippedShort,
    skippedHash: opts.skippedHash,
    skippedUnchanged: opts.skippedUnchanged,
    zeroBlockPages: opts.zeroBlockPages,
    nasPathPages: opts.nasPathPages,
    embedTokens: opts.embedTokens,
    elapsedSec: opts.elapsedSec,
    rootStats: [...rootMap.entries()]
      .map(([root_title, v]) => ({ root_title, ...v }))
      .sort((a, b) => b.blocks - a.blocks),
    depthStats,
    topPages,
    tableSizes: {}
  };
}

async function main(): Promise<void> {
  const started = Date.now();
  const notionToken = process.env.NOTION_TOKEN?.trim();
  if (!notionToken) throw new Error("NOTION_TOKEN 필요");
  if (!process.env.LUNA_OPENAI_API_KEY?.trim()) {
    throw new Error("LUNA_OPENAI_API_KEY 필요");
  }

  const admin = createAdmin();
  const scanBatch = newScanBatch();
  const client = new NotionIndexClient(notionToken);
  const previousCount = await getPreviousPageCount(admin);
  const existingPages = await loadExistingPages(admin);
  const existingBlockCounts = await countByPage(admin, "luna_notion_blocks");
  const existingEmbedCounts = await countByPage(
    admin,
    "luna_notion_chunk_embeddings"
  );

  log(`[index-notion] scan_batch=${scanBatch} previous_pages=${previousCount}`);

  const searchResults = await client.searchAll();
  const pagesRaw = collectPagesFromSearch(searchResults);
  log(`페이지 수집 ${pagesRaw.length.toLocaleString()} / ${pagesRaw.length.toLocaleString()}`);

  const meta = await buildMetaGraph(client, searchResults);
  const pages: PageRow[] = pagesRaw.map((page) => ({
    ...pageToIndexed(page, meta),
    scan_batch: scanBatch,
    indexed_at: null
  }));

  const blocksByPage = new Map<string, number>();
  let zeroBlockPages = 0;
  let nasPathPages = 0;
  let skippedShort = 0;
  let skippedHash = 0;
  let skippedUnchanged = 0;
  let newEmbedCount = 0;
  let embedTokens = 0;
  let runningBlocks = 0;
  let runningEmbeds = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const prev = existingPages.get(page.page_id);
    const unchanged =
      Boolean(prev?.indexed_at) &&
      sameEditedTime(prev?.last_edited_time, page.last_edited_time);

    if (unchanged) {
      skippedUnchanged += 1;
      const blockN = existingBlockCounts.get(page.page_id) ?? 0;
      const embedN = existingEmbedCounts.get(page.page_id) ?? 0;
      blocksByPage.set(page.page_id, blockN);
      runningBlocks += blockN;
      runningEmbeds += embedN;
    } else {
      await upsertBatch(admin, "luna_notion_pages", [page], "page_id");

      const rawBlocks = await client.fetchPageBlocks(page.page_id);
      const indexed = blocksToIndexed(page.page_id, rawBlocks);
      if (indexed.length === 0) zeroBlockPages += 1;

      const bodyText = indexed.map((b) => b.text).join("\n");
      const nas = firstNasPath([bodyText, page.title]);
      if (nas) {
        page.nas_path = nas;
        nasPathPages += 1;
      }

      await upsertBatch(admin, "luna_notion_blocks", indexed, "block_id");
      await deleteStaleBlocksForPage(
        admin,
        page.page_id,
        new Set(indexed.map((b) => b.block_id))
      );

      const chunks = blocksToChunks(page.page_id, indexed);
      await upsertBatch(
        admin,
        "luna_notion_chunks",
        chunks.map((c) => ({
          chunk_id: c.chunk_id,
          page_id: c.page_id,
          heading: c.heading,
          text: c.text,
          block_ids: c.block_ids,
          position: c.position,
          content_hash: c.content_hash,
          indexed_at: new Date().toISOString()
        })),
        "chunk_id"
      );
      await deleteStaleChunksForPage(
        admin,
        page.page_id,
        new Set(chunks.map((c) => c.chunk_id))
      );

      const embedded = await embedAndSaveChunks(admin, chunks);
      skippedShort += embedded.skippedShort;
      skippedHash += embedded.skippedHash;
      newEmbedCount += embedded.created;
      embedTokens += embedded.tokens;

      const doneAt = new Date().toISOString();
      page.indexed_at = doneAt;
      const { error: doneErr } = await admin
        .from("luna_notion_pages")
        .update({ indexed_at: doneAt, nas_path: page.nas_path })
        .eq("page_id", page.page_id);
      if (doneErr) {
        throw new Error(`luna_notion_pages complete: ${doneErr.message}`);
      }

      blocksByPage.set(page.page_id, indexed.length);
      runningBlocks += indexed.length;
      runningEmbeds += chunks.length;
    }

    if ((i + 1) % 25 === 0 || i + 1 === pages.length) {
      logProgress(i + 1, pages.length, runningBlocks, runningEmbeds);
    }
  }

  const newCount = pages.length;
  const minRequired =
    previousCount > 0
      ? Math.floor(previousCount * NOTION_INDEX_VALIDATE_RATIO)
      : 0;
  const passed = previousCount === 0 || newCount >= minRequired;
  log(
    `[index-notion] validate (post-write) previous=${previousCount} new=${newCount} min=${minRequired} passed=${passed}`
  );

  if (passed) {
    await deleteOrphanPages(
      admin,
      new Set(pages.map((p) => p.page_id))
    );
  } else {
    log("[index-notion] 검증 미달 — 이전 세대 페이지는 지우지 않음");
  }

  const elapsedSec = Math.round((Date.now() - started) / 10) / 100;
  const embedKept = [...blocksByPage.keys()].reduce((sum, id) => {
    return sum + (blocksByPage.get(id) ?? 0);
  }, 0);
  const stats = buildStats({
    pages,
    blocksByPage,
    embedCount: embedKept - skippedShort,
    skippedShort,
    skippedHash,
    skippedUnchanged,
    zeroBlockPages,
    nasPathPages,
    embedTokens,
    elapsedSec
  });
  stats.tableSizes = await fetchTableSizes(admin);

  const costUsd = estimateEmbeddingCostUsd(embedTokens);

  console.log("\n=== 노션 색인 통계 ===");
  console.log("1. 최종", {
    pages: stats.pages,
    blocks: stats.blocks,
    embeddings: stats.embeddings,
    skipped_unchanged: stats.skippedUnchanged,
    new_embeddings_this_run: newEmbedCount
  });
  console.log("2. 시간·비용", {
    elapsed_sec: stats.elapsedSec,
    embed_tokens: stats.embedTokens,
    embed_cost_usd: Math.round(costUsd * 10000) / 10000
  });
  console.log("3. root_title 별 (pages / blocks)");
  for (const row of stats.rootStats.slice(0, 30)) {
    console.log(`   ${row.root_title}: ${row.pages} / ${row.blocks}`);
  }
  console.log("4. 블록 0개 페이지", stats.zeroBlockPages);
  console.log("5. 15자 미만 스킵", stats.skippedShort);
  console.log("   content_hash 재사용 스킵", stats.skippedHash);
  console.log("   last_edited 동일 스킵", stats.skippedUnchanged);
  console.log("6. 블록 상위 20");
  for (const row of stats.topPages) {
    console.log(`   ${row.blocks}\t${row.root_title ?? "-"}\t${row.title}`);
  }
  console.log("7. nas_path 채워진 페이지", stats.nasPathPages);
  console.log("8. depth 분포", stats.depthStats);
  console.log("9. DB", stats.tableSizes);
  console.log("=== 완료 ===\n");
}

main().catch((err) => {
  console.error("[index-notion]", err);
  process.exit(1);
});
