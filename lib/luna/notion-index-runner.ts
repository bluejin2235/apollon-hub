import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingToSql } from "@/lib/luna/embedding";
import { kstDayBounds } from "@/lib/luna/selfstudy";
import { lunaNotify } from "@/lib/luna/notify";
import {
  blocksToIndexed,
  buildMetaGraph,
  chunk,
  collectPagesFromSearch,
  createEmbeddingsBatch,
  firstNasPath,
  newScanBatch,
  NotionIndexClient,
  NOTION_INDEX_EMBED_BATCH,
  NOTION_INDEX_INSERT_BATCH,
  NOTION_INDEX_VALIDATE_RATIO,
  pageToIndexed,
  type IndexedBlock,
  type IndexedPage
} from "@/lib/luna/notion-index";
import {
  getNotionIndexExclude,
  pathIsExcluded,
  type NotionIndexMode
} from "@/lib/luna/notion-index-settings";

function isMissingTableError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist/i.test(msg) ||
    /Could not find the table/i.test(msg)
  );
}

/** 한 청크에서 쓰는 시간(ms). maxDuration 300s 기준 여유. */
export const NOTION_INDEX_CHUNK_BUDGET_MS = 240_000;

export type NotionIndexRunRow = {
  id: string;
  mode: NotionIndexMode;
  started_at: string;
  finished_at: string | null;
  pages_total: number;
  pages_processed: number;
  pages_skipped: number;
  blocks: number;
  embeddings_added: number;
  duration_ms: number | null;
  status: "running" | "success" | "failed";
  error_message: string | null;
  triggered_by: "cron" | "manual";
  triggered_by_user: string | null;
  abort_requested: boolean;
  checkpoint: NotionIndexCheckpoint;
};

export type NotionIndexCheckpoint = {
  scan_batch?: string;
  page_ids?: string[];
  page_meta?: Record<
    string,
    {
      title: string;
      parent_type: string | null;
      parent_id: string | null;
      root_title: string | null;
      path_titles: string[];
      depth: number;
      nas_path: string | null;
      url: string | null;
      object_type: string;
      archived: boolean;
      last_edited_time: string | null;
    }
  >;
  cursor?: number;
  phase?: "init" | "pages" | "orphan" | "done";
  changed_pages?: number;
};

type ExistingPage = {
  last_edited_time: string | null;
  indexed_at: string | null;
};

type PageRow = IndexedPage & {
  scan_batch: string;
  indexed_at: string | null;
};

function sameEditedTime(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
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
      if (isMissingTableError(error)) return map;
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
  table: "luna_notion_blocks" | "luna_notion_embeddings"
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
      if (isMissingTableError(error)) return map;
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

async function loadExistingHashes(
  admin: SupabaseClient,
  blockIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const part of chunk(blockIds, NOTION_INDEX_INSERT_BATCH)) {
    if (part.length === 0) continue;
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

async function embedAndSavePage(
  admin: SupabaseClient,
  blocks: IndexedBlock[],
  minChars: number
): Promise<{ created: number; skippedShort: number; skippedHash: number }> {
  const embedCandidates = blocks.filter((b) => b.text.length >= minChars);
  const skippedShort = blocks.length - embedCandidates.length;
  const existingHashes = await loadExistingHashes(
    admin,
    embedCandidates.map((b) => b.block_id)
  );

  const toEmbed: IndexedBlock[] = [];
  let skippedHash = 0;
  for (const block of embedCandidates) {
    if (existingHashes.get(block.block_id) === block.content_hash) {
      skippedHash += 1;
      continue;
    }
    toEmbed.push(block);
  }

  let created = 0;
  for (const batch of chunk(toEmbed, NOTION_INDEX_EMBED_BATCH)) {
    const { vectors } = await createEmbeddingsBatch(batch.map((b) => b.text));
    const now = new Date().toISOString();
    const rows: Array<{
      block_id: string;
      page_id: string;
      content_hash: string;
      embedding: string;
      updated_at: string;
    }> = [];
    batch.forEach((block, idx) => {
      const vector = vectors[idx];
      if (!vector) return;
      rows.push({
        block_id: block.block_id,
        page_id: block.page_id,
        content_hash: block.content_hash,
        embedding: embeddingToSql(vector),
        updated_at: now
      });
    });
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("luna_notion_embeddings")
      .upsert(rows, { onConflict: "block_id" });
    if (error) throw new Error(`luna_notion_embeddings upsert: ${error.message}`);
    created += rows.length;
  }

  return { created, skippedShort, skippedHash };
}

function asCheckpoint(raw: unknown): NotionIndexCheckpoint {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as NotionIndexCheckpoint;
}

function mapRun(row: Record<string, unknown>): NotionIndexRunRow {
  return {
    id: String(row.id),
    mode: row.mode === "incremental" ? "incremental" : "full",
    started_at: String(row.started_at),
    finished_at: typeof row.finished_at === "string" ? row.finished_at : null,
    pages_total: Number(row.pages_total) || 0,
    pages_processed: Number(row.pages_processed) || 0,
    pages_skipped: Number(row.pages_skipped) || 0,
    blocks: Number(row.blocks) || 0,
    embeddings_added: Number(row.embeddings_added) || 0,
    duration_ms:
      typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms)
        ? row.duration_ms
        : null,
    status:
      row.status === "success" || row.status === "failed" || row.status === "running"
        ? row.status
        : "failed",
    error_message:
      typeof row.error_message === "string" ? row.error_message : null,
    triggered_by: row.triggered_by === "manual" ? "manual" : "cron",
    triggered_by_user:
      typeof row.triggered_by_user === "string" ? row.triggered_by_user : null,
    abort_requested: row.abort_requested === true,
    checkpoint: asCheckpoint(row.checkpoint)
  };
}

export async function getRunningNotionIndex(
  admin: SupabaseClient
): Promise<NotionIndexRunRow | null> {
  const { data, error } = await admin
    .from("luna_notion_index_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data) return null;
  return mapRun(data as Record<string, unknown>);
}

export async function listNotionIndexRuns(
  admin: SupabaseClient,
  limit = 10
): Promise<NotionIndexRunRow[]> {
  const { data, error } = await admin
    .from("luna_notion_index_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => mapRun(row as Record<string, unknown>));
}

export async function alreadyStartedNotionIndexToday(
  admin: SupabaseClient,
  mode: NotionIndexMode,
  triggeredBy: "cron" | "manual" = "cron"
): Promise<boolean> {
  const { startIso, endIso } = kstDayBounds();
  const { data, error } = await admin
    .from("luna_notion_index_runs")
    .select("id, status")
    .eq("mode", mode)
    .eq("triggered_by", triggeredBy)
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .in("status", ["running", "success"])
    .limit(1);
  if (error) {
    if (isMissingTableError(error)) return false;
    console.error("[notion-index] alreadyStarted", error);
    return false;
  }
  return (data ?? []).length > 0;
}

async function updateRun(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
): Promise<NotionIndexRunRow> {
  const { data, error } = await admin
    .from("luna_notion_index_runs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`run update: ${error.message}`);
  return mapRun(data as Record<string, unknown>);
}

async function failRun(
  admin: SupabaseClient,
  run: NotionIndexRunRow,
  message: string
): Promise<NotionIndexRunRow> {
  const finished = new Date().toISOString();
  const durationMs = Math.max(
    0,
    new Date(finished).getTime() - new Date(run.started_at).getTime()
  );
  const updated = await updateRun(admin, run.id, {
    status: "failed",
    finished_at: finished,
    duration_ms: durationMs,
    error_message: message.slice(0, 500)
  });
  await lunaNotify(
    admin,
    "notion_index",
    "노션 색인 실패",
    `${run.mode === "full" ? "전체" : "증분"} · ${message.slice(0, 160)} · ${updated.pages_processed.toLocaleString()} / ${updated.pages_total.toLocaleString()}에서 멈춤. 이전 색인은 그대로입니다.`,
    {
      level: "error",
      link: "/settings?tab=luna&luna=knowledge&sub=notion",
      meta: { run_id: run.id, mode: run.mode }
    }
  );
  return updated;
}

export async function requestAbortNotionIndex(
  admin: SupabaseClient,
  runId?: string
): Promise<NotionIndexRunRow | null> {
  const running = runId
    ? await admin
        .from("luna_notion_index_runs")
        .select("*")
        .eq("id", runId)
        .eq("status", "running")
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) throw error;
          return data ? mapRun(data as Record<string, unknown>) : null;
        })
    : await getRunningNotionIndex(admin);
  if (!running) return null;
  return updateRun(admin, running.id, { abort_requested: true });
}

export type StartNotionIndexOpts = {
  mode: NotionIndexMode;
  triggeredBy: "cron" | "manual";
  userId?: string | null;
  /** 기존 running 청크 이어가기 */
  continueRunId?: string;
  budgetMs?: number;
};

export type NotionIndexChunkResult = {
  run: NotionIndexRunRow;
  continued: boolean;
  done: boolean;
};

async function initCheckpoint(
  admin: SupabaseClient
): Promise<NotionIndexCheckpoint> {
  const notionToken = process.env.NOTION_TOKEN?.trim();
  if (!notionToken) throw new Error("NOTION_TOKEN 이 없습니다");
  if (!process.env.LUNA_OPENAI_API_KEY?.trim()) {
    throw new Error("LUNA_OPENAI_API_KEY 가 없습니다");
  }

  const exclude = await getNotionIndexExclude(admin);
  const client = new NotionIndexClient(notionToken);
  const searchResults = await client.searchAll();
  const pagesRaw = collectPagesFromSearch(searchResults);
  const meta = await buildMetaGraph(client, searchResults);

  const page_meta: NonNullable<NotionIndexCheckpoint["page_meta"]> = {};
  const page_ids: string[] = [];

  for (const page of pagesRaw) {
    const indexed = pageToIndexed(page, meta);
    if (pathIsExcluded(indexed.path_titles, indexed.title, exclude.exclude_paths)) {
      continue;
    }
    page_ids.push(indexed.page_id);
    page_meta[indexed.page_id] = {
      title: indexed.title,
      parent_type: indexed.parent_type,
      parent_id: indexed.parent_id,
      root_title: indexed.root_title,
      path_titles: indexed.path_titles,
      depth: indexed.depth,
      nas_path: indexed.nas_path,
      url: indexed.url,
      object_type: indexed.object_type,
      archived: indexed.archived,
      last_edited_time: indexed.last_edited_time
    };
  }

  return {
    scan_batch: newScanBatch(),
    page_ids,
    page_meta,
    cursor: 0,
    phase: "pages",
    changed_pages: 0
  };
}

/**
 * 색인 한 청크. 시간 예산이 끝나면 status=running 으로 두고 continued=true.
 */
export async function runNotionIndexChunk(
  admin: SupabaseClient,
  opts: StartNotionIndexOpts
): Promise<NotionIndexChunkResult> {
  const budgetMs = opts.budgetMs ?? NOTION_INDEX_CHUNK_BUDGET_MS;
  const chunkStarted = Date.now();

  let run: NotionIndexRunRow;

  if (opts.continueRunId) {
    const { data, error } = await admin
      .from("luna_notion_index_runs")
      .select("*")
      .eq("id", opts.continueRunId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("이어갈 색인 실행을 찾을 수 없습니다");
    run = mapRun(data as Record<string, unknown>);
    if (run.status !== "running") {
      return { run, continued: false, done: run.status === "success" };
    }
  } else {
    const existing = await getRunningNotionIndex(admin);
    if (existing) {
      run = existing;
    } else {
      const { data, error } = await admin
        .from("luna_notion_index_runs")
        .insert({
          mode: opts.mode,
          status: "running",
          triggered_by: opts.triggeredBy,
          triggered_by_user: opts.userId ?? null,
          checkpoint: { phase: "init" },
          pages_total: 0,
          pages_processed: 0,
          pages_skipped: 0,
          blocks: 0,
          embeddings_added: 0
        })
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error)) {
          throw new Error(
            "luna_notion_index_runs 테이블이 없습니다. 마이그레이션을 적용하세요."
          );
        }
        throw error;
      }
      run = mapRun(data as Record<string, unknown>);
    }
  }

  try {
    let cp = { ...run.checkpoint };
    if (!cp.phase || cp.phase === "init" || !cp.page_ids?.length) {
      cp = await initCheckpoint(admin);
      run = await updateRun(admin, run.id, {
        pages_total: cp.page_ids?.length ?? 0,
        checkpoint: cp
      });
      cp = run.checkpoint;
    }

    if (run.abort_requested) {
      const finished = new Date().toISOString();
      const durationMs = Math.max(
        0,
        new Date(finished).getTime() - new Date(run.started_at).getTime()
      );
      run = await updateRun(admin, run.id, {
        status: "success",
        finished_at: finished,
        duration_ms: durationMs,
        error_message: "사용자 중단 · 지금까지 색인한 것은 남음",
        checkpoint: { ...cp, phase: "done" }
      });
      return { run, continued: false, done: true };
    }

    const exclude = await getNotionIndexExclude(admin);
    const minChars = exclude.min_block_length;
    const notionToken = process.env.NOTION_TOKEN?.trim();
    if (!notionToken) throw new Error("NOTION_TOKEN 이 없습니다");
    const client = new NotionIndexClient(notionToken);
    const existingPages = await loadExistingPages(admin);
    const existingBlockCounts = await countByPage(admin, "luna_notion_blocks");

    const pageIds = cp.page_ids ?? [];
    const pageMeta = cp.page_meta ?? {};
    let cursor = cp.cursor ?? 0;
    let pagesSkipped = run.pages_skipped;
    let pagesProcessed = run.pages_processed;
    let blocks = run.blocks;
    let embeddingsAdded = run.embeddings_added;
    let changedPages = cp.changed_pages ?? 0;
    const scanBatch = cp.scan_batch ?? newScanBatch();

    while (cursor < pageIds.length) {
      if (Date.now() - chunkStarted > budgetMs) {
        run = await updateRun(admin, run.id, {
          pages_processed: pagesProcessed,
          pages_skipped: pagesSkipped,
          blocks,
          embeddings_added: embeddingsAdded,
          checkpoint: {
            ...cp,
            cursor,
            phase: "pages",
            changed_pages: changedPages,
            scan_batch: scanBatch
          }
        });
        return { run, continued: true, done: false };
      }

      const { data: fresh } = await admin
        .from("luna_notion_index_runs")
        .select("abort_requested")
        .eq("id", run.id)
        .maybeSingle();
      if (fresh?.abort_requested === true) {
        const finished = new Date().toISOString();
        const durationMs = Math.max(
          0,
          new Date(finished).getTime() - new Date(run.started_at).getTime()
        );
        run = await updateRun(admin, run.id, {
          status: "success",
          finished_at: finished,
          duration_ms: durationMs,
          pages_processed: pagesProcessed,
          pages_skipped: pagesSkipped,
          blocks,
          embeddings_added: embeddingsAdded,
          error_message: "사용자 중단 · 지금까지 색인한 것은 남음",
          checkpoint: {
            ...cp,
            cursor,
            phase: "done",
            changed_pages: changedPages
          }
        });
        return { run, continued: false, done: true };
      }

      const pageId = pageIds[cursor]!;
      const meta = pageMeta[pageId];
      if (!meta) {
        cursor += 1;
        pagesProcessed += 1;
        continue;
      }

      const page: PageRow = {
        page_id: pageId,
        ...meta,
        scan_batch: scanBatch,
        indexed_at: null
      };

      const prev = existingPages.get(pageId);
      const unchanged =
        Boolean(prev?.indexed_at) &&
        sameEditedTime(prev?.last_edited_time, page.last_edited_time);

      if (unchanged) {
        pagesSkipped += 1;
        pagesProcessed += 1;
        blocks += existingBlockCounts.get(pageId) ?? 0;
        cursor += 1;
        continue;
      }

      await upsertBatch(admin, "luna_notion_pages", [page], "page_id");
      const rawBlocks = await client.fetchPageBlocks(pageId);
      const indexed = blocksToIndexed(pageId, rawBlocks);
      const bodyText = indexed.map((b) => b.text).join("\n");
      const nas = firstNasPath([bodyText, page.title]);
      if (nas) page.nas_path = nas;

      await upsertBatch(admin, "luna_notion_blocks", indexed, "block_id");
      await deleteStaleBlocksForPage(
        admin,
        pageId,
        new Set(indexed.map((b) => b.block_id))
      );

      const embedded = await embedAndSavePage(admin, indexed, minChars);
      embeddingsAdded += embedded.created;
      blocks += indexed.length;
      changedPages += 1;

      const doneAt = new Date().toISOString();
      const { error: doneErr } = await admin
        .from("luna_notion_pages")
        .update({ indexed_at: doneAt, nas_path: page.nas_path })
        .eq("page_id", pageId);
      if (doneErr) throw new Error(`luna_notion_pages complete: ${doneErr.message}`);

      pagesProcessed += 1;
      cursor += 1;

      if (cursor % 10 === 0) {
        await updateRun(admin, run.id, {
          pages_processed: pagesProcessed,
          pages_skipped: pagesSkipped,
          blocks,
          embeddings_added: embeddingsAdded,
          checkpoint: {
            ...cp,
            cursor,
            phase: "pages",
            changed_pages: changedPages,
            scan_batch: scanBatch,
            page_ids: pageIds,
            page_meta: pageMeta
          }
        });
      }
    }

    // orphan cleanup (full only)
    if (run.mode === "full") {
      const previousCount = existingPages.size;
      const newCount = pageIds.length;
      const minRequired =
        previousCount > 0
          ? Math.floor(previousCount * NOTION_INDEX_VALIDATE_RATIO)
          : 0;
      const passed = previousCount === 0 || newCount >= minRequired;
      if (passed) {
        await deleteOrphanPages(admin, new Set(pageIds));
      }
    }

    const finished = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(finished).getTime() - new Date(run.started_at).getTime()
    );
    run = await updateRun(admin, run.id, {
      status: "success",
      finished_at: finished,
      duration_ms: durationMs,
      pages_total: pageIds.length,
      pages_processed: pagesProcessed,
      pages_skipped: pagesSkipped,
      blocks,
      embeddings_added: embeddingsAdded,
      error_message: null,
      checkpoint: {
        scan_batch: scanBatch,
        cursor: pageIds.length,
        phase: "done",
        changed_pages: changedPages,
        page_ids: pageIds
      }
    });
    return { run, continued: false, done: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "색인 실패";
    console.error("[notion-index]", err);
    const failed = await failRun(admin, run, message);
    return { run: failed, continued: false, done: true };
  }
}

/** 통계 집계 (개요 API용) */
export async function getNotionIndexStats(admin: SupabaseClient): Promise<{
  pages: number;
  blocks: number;
  embeddings: number;
  teamspaces: number;
  last_success: NotionIndexRunRow | null;
  last_failed: NotionIndexRunRow | null;
  avg_blocks_per_page: number | null;
}> {
  const countExact = async (table: string): Promise<number> => {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) return 0;
    return count ?? 0;
  };

  const [pages, blocks, embeddings] = await Promise.all([
    countExact("luna_notion_pages"),
    countExact("luna_notion_blocks"),
    countExact("luna_notion_embeddings")
  ]);

  let teamspaces = 0;
  {
    const roots = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("luna_notion_pages")
        .select("root_title")
        .order("page_id")
        .range(from, from + 999);
      if (error) break;
      const rows = data ?? [];
      for (const row of rows) {
        if (typeof row.root_title === "string" && row.root_title.trim()) {
          roots.add(row.root_title.trim());
        }
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
    teamspaces = roots.size;
  }

  let last_success: NotionIndexRunRow | null = null;
  let last_failed: NotionIndexRunRow | null = null;
  {
    const { data } = await admin
      .from("luna_notion_index_runs")
      .select("*")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) last_success = mapRun(data as Record<string, unknown>);
  }
  {
    const { data } = await admin
      .from("luna_notion_index_runs")
      .select("*")
      .eq("status", "failed")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) last_failed = mapRun(data as Record<string, unknown>);
  }

  return {
    pages,
    blocks,
    embeddings,
    teamspaces,
    last_success,
    last_failed,
    avg_blocks_per_page:
      pages > 0 ? Math.round(blocks / pages) : null
  };
}
