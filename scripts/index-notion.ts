/**
 * 노션 1차 전체 색인. 실행은 블루진.
 *
 *   npx tsx scripts/index-notion.ts
 *
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

type PageRow = IndexedPage & {
  scan_batch: string;
  indexed_at: string;
};

type BlockRow = IndexedBlock;

type EmbedRow = {
  block_id: string;
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

function progress(label: string, current: number, total: number): void {
  log(`${label} ${current.toLocaleString()} / ${total.toLocaleString()}`);
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

async function deleteBatch(admin: SupabaseClient, batch: string): Promise<void> {
  const { data: pages, error: pageErr } = await admin
    .from("luna_notion_pages")
    .select("page_id")
    .eq("scan_batch", batch);
  if (pageErr) throw pageErr;
  const pageIds = (pages ?? []).map((p) => p.page_id as string);
  if (pageIds.length === 0) return;

  for (const part of chunk(pageIds, NOTION_INDEX_INSERT_BATCH)) {
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
  }
  await admin.from("luna_notion_pages").delete().eq("scan_batch", batch);
}

async function deleteOtherBatches(
  admin: SupabaseClient,
  keepBatch: string
): Promise<void> {
  const { data, error } = await admin
    .from("luna_notion_pages")
    .select("scan_batch")
    .neq("scan_batch", keepBatch);
  if (error) throw error;
  const batches = [...new Set((data ?? []).map((r) => r.scan_batch as string))];
  for (const batch of batches) {
    if (batch) await deleteBatch(admin, batch);
  }
}

async function deleteStaleBlocks(
  admin: SupabaseClient,
  livePageIds: Set<string>,
  liveBlockIds: Set<string>
): Promise<void> {
  const { data, error } = await admin
    .from("luna_notion_blocks")
    .select("block_id, page_id");
  if (error) throw error;
  const stale = (data ?? []).filter((row) => {
    const blockId = row.block_id as string;
    const pageId = row.page_id as string;
    return !liveBlockIds.has(blockId) || !livePageIds.has(pageId);
  });
  const staleBlockIds = stale.map((r) => r.block_id as string);
  for (const part of chunk(staleBlockIds, NOTION_INDEX_INSERT_BATCH)) {
    if (part.length === 0) continue;
    await admin.from("luna_notion_embeddings").delete().in("block_id", part);
    await admin.from("luna_notion_blocks").delete().in("block_id", part);
  }
}

async function loadExistingHashes(
  admin: SupabaseClient,
  blockIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(blockIds, NOTION_INDEX_INSERT_BATCH)) {
    const { data, error } = await admin
      .from("luna_notion_embeddings")
      .select("block_id, content_hash")
      .in("block_id", part);
    if (error) throw error;
    for (const row of data ?? []) {
      map.set(row.block_id as string, row.content_hash as string);
    }
  }
  return map;
}

async function fetchTableSizes(admin: SupabaseClient): Promise<Record<string, string | number>> {
  const tables = [
    "luna_notion_pages",
    "luna_notion_blocks",
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

function buildStats(opts: {
  pages: PageRow[];
  blocks: BlockRow[];
  embedCount: number;
  skippedShort: number;
  skippedHash: number;
  zeroBlockPages: number;
  nasPathPages: number;
  embedTokens: number;
  elapsedSec: number;
}): Stats {
  const blocksByPage = new Map<string, number>();
  for (const b of opts.blocks) {
    blocksByPage.set(b.page_id, (blocksByPage.get(b.page_id) ?? 0) + 1);
  }

  const rootMap = new Map<string, { pages: number; blocks: number }>();
  for (const p of opts.pages) {
    const root = p.root_title ?? "(unknown)";
    const cur = rootMap.get(root) ?? { pages: 0, blocks: 0 };
    cur.pages += 1;
    cur.blocks += blocksByPage.get(p.page_id) ?? 0;
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
      blocks: blocksByPage.get(p.page_id) ?? 0
    }))
    .sort((a, b) => b.blocks - a.blocks)
    .slice(0, 20);

  return {
    pages: opts.pages.length,
    blocks: opts.blocks.length,
    embeddings: opts.embedCount,
    skippedShort: opts.skippedShort,
    skippedHash: opts.skippedHash,
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
  const indexedAt = new Date().toISOString();
  const client = new NotionIndexClient(notionToken);
  const previousCount = await getPreviousPageCount(admin);

  log(`[index-notion] scan_batch=${scanBatch} previous_pages=${previousCount}`);

  const searchResults = await client.searchAll();
  const pagesRaw = collectPagesFromSearch(searchResults);
  progress("페이지 수집", pagesRaw.length, pagesRaw.length);

  const meta = await buildMetaGraph(client, searchResults);
  const pages: PageRow[] = pagesRaw.map((page) => ({
    ...pageToIndexed(page, meta),
    scan_batch: scanBatch,
    indexed_at: indexedAt
  }));

  const allBlocks: BlockRow[] = [];
  let zeroBlockPages = 0;
  let nasPathPages = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    if ((i + 1) % 25 === 0 || i + 1 === pages.length) {
      progress("블록 읽기", i + 1, pages.length);
    }
    const rawBlocks = await client.fetchPageBlocks(page.page_id);
    const indexed = blocksToIndexed(page.page_id, rawBlocks);
    if (indexed.length === 0) zeroBlockPages += 1;

    const bodyText = indexed.map((b) => b.text).join("\n");
    const nas = firstNasPath([bodyText, page.title]);
    if (nas) {
      page.nas_path = nas;
      nasPathPages += 1;
    }

    for (const block of indexed) {
      allBlocks.push(block);
    }
  }

  const newCount = pages.length;
  const minRequired =
    previousCount > 0
      ? Math.floor(previousCount * NOTION_INDEX_VALIDATE_RATIO)
      : 0;
  const passed = previousCount === 0 || newCount >= minRequired;
  log(
    `[index-notion] validate (pre-write) previous=${previousCount} new=${newCount} min=${minRequired} passed=${passed}`
  );
  if (!passed) {
    log("[index-notion] FAILED — page count below threshold, nothing written");
    process.exit(2);
  }

  log(`[index-notion] upsert pages=${pages.length} blocks=${allBlocks.length}`);
  await upsertBatch(admin, "luna_notion_pages", pages, "page_id");
  await upsertBatch(admin, "luna_notion_blocks", allBlocks, "block_id");

  const embedCandidates = allBlocks.filter(
    (b) => b.text.length >= NOTION_INDEX_MIN_EMBED_CHARS
  );
  const skippedShort = allBlocks.length - embedCandidates.length;
  const existingHashes = await loadExistingHashes(
    admin,
    embedCandidates.map((b) => b.block_id)
  );

  const toEmbed: BlockRow[] = [];
  let skippedHash = 0;
  for (const block of embedCandidates) {
    const prev = existingHashes.get(block.block_id);
    if (prev === block.content_hash) {
      skippedHash += 1;
      continue;
    }
    toEmbed.push(block);
  }

  let newEmbedCount = 0;
  let embedTokens = 0;
  const embedRows: EmbedRow[] = [];

  for (let i = 0; i < toEmbed.length; i += NOTION_INDEX_EMBED_BATCH) {
    const batch = toEmbed.slice(i, i + NOTION_INDEX_EMBED_BATCH);
    progress("임베딩", Math.min(i + batch.length, toEmbed.length), toEmbed.length);
    const { vectors, tokens } = await createEmbeddingsBatch(batch.map((b) => b.text));
    embedTokens += tokens;
    const now = new Date().toISOString();
    batch.forEach((block, idx) => {
      const vector = vectors[idx];
      if (!vector) return;
      embedRows.push({
        block_id: block.block_id,
        page_id: block.page_id,
        content_hash: block.content_hash,
        embedding: embeddingToSql(vector),
        updated_at: now
      });
    });
  }

  for (const part of chunk(embedRows, NOTION_INDEX_INSERT_BATCH)) {
    const { error } = await admin
      .from("luna_notion_embeddings")
      .upsert(part, { onConflict: "block_id" });
    if (error) throw new Error(`luna_notion_embeddings upsert: ${error.message}`);
    newEmbedCount += part.length;
  }

  const totalEmbeddings = embedCandidates.length - skippedHash;

  await deleteOtherBatches(admin, scanBatch);
  await deleteStaleBlocks(
    admin,
    new Set(pages.map((p) => p.page_id)),
    new Set(allBlocks.map((b) => b.block_id))
  );

  const elapsedSec = Math.round((Date.now() - started) / 10) / 100;
  const stats = buildStats({
    pages,
    blocks: allBlocks,
    embedCount: totalEmbeddings,
    skippedShort,
    skippedHash,
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
