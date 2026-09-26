import { publishNasText, type NasTextPublication } from "@/lib/luna/nas-text-store";
import { describeNasError } from "@/lib/luna/nas-error";
/**
 * Work서버 문서 본문 추출 → nas_file_text / nas_file_chunks
 * 임베딩은 scripts/embed-nas-chunks.ts 에서 분리.
 *
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/index-nas-text.ts --limit=1000
 *   npx tsx ... scripts/index-nas-text.ts --dry-run
 *   npx tsx ... scripts/index-nas-text.ts --ext=pdf --since=2026-09-01
 *
 * 회사 PC 대화형 세션(T:/P:) · 읽기만.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  chunkNasText,
  extOfNasPath,
  extractNasFileText,
  hashNasText,
  isBackupPath,
  resolveNasFullPath,
  sanitizeNasText,
  type NasTextExt
} from "@/lib/luna/nas-text";
import {
  finishNasTextRun,
  startNasTextRun,
  updateNasTextRunProgress,
  type NasTextRunProgress
} from "@/lib/luna/nas-text-runs";

type NasDirRow = {
  drive: string;
  path: string;
  size_bytes: number | null;
  modified_at: string | null;
};

type ExistingRow = {
  size_bytes: number | null;
  path: string;
  drive: string;
  modified_at: string | null;
  content_hash: string | null;
  status: string;
  updated_at: string;
};

type Args = {
  limit: number | null;
  ext: string | null;
  dryRun: boolean;
  resume: boolean;
  since: string | null;
  purgeMissing: boolean;
  kind: "full" | "incremental";
};

function parseArgs(argv: string[]): Args {
  let limit: number | null = null;
  let ext: string | null = null;
  let dryRun = false;
  let resume = true;
  let since: string | null = null;
  let purgeMissing = false;
  let kind: "full" | "incremental" = "full";
  for (const a of argv) {
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (a.startsWith("--ext=")) {
      ext = a.slice("--ext=".length).toLowerCase().replace(/^\./, "");
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--resume") resume = true;
    else if (a === "--no-resume") resume = false;
    else if (a.startsWith("--since=")) since = a.slice("--since=".length);
    else if (a === "--purge-missing") purgeMissing = true;
    else if (a === "--incremental") kind = "incremental";
  }
  return { limit, ext, dryRun, resume, since, purgeMissing, kind };
}

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

async function fetchLatestBatches(
  admin: SupabaseClient
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const drive of ["T", "P"]) {
    const { data, error } = await admin
      .from("nas_directory")
      .select("scan_batch")
      .eq("drive", drive)
      .order("scan_batch", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.scan_batch) map.set(drive, String(data.scan_batch));
  }
  return map;
}

async function fetchCandidates(
  admin: SupabaseClient,
  opts: Args,
  batches: Map<string, string>,
  existing: Map<string, ExistingRow>
): Promise<{ rows: NasDirRow[]; scanned: number; alreadyDone: number }> {
  const out: NasDirRow[] = [];
  let scanned = 0;
  let alreadyDone = 0;
  const pageSize = 1000;
  for (const drive of ["T", "P"]) {
    const batch = batches.get(drive);
    if (!batch) continue;
    let from = 0;
    while (true) {
      let q = admin
        .from("nas_directory")
        .select("drive, path, size_bytes, modified_at")
        .eq("type", "file")
        .eq("drive", drive)
        .eq("scan_batch", batch)
        .order("path")
        .range(from, from + pageSize - 1);
      if (opts.since) {
        q = q.gte("modified_at", `${opts.since}T00:00:00+09:00`);
      }
      if (opts.ext) {
        q = q.ilike("path", `%.${opts.ext}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as NasDirRow[];
      for (const r of rows) {
        scanned += 1;
        if (!r.path || isBackupPath(r.path)) continue;
        const e = extOfNasPath(r.path);
        if (!e) continue;
        if (opts.ext && e !== opts.ext) continue;
        if (!needsWork(r, existing.get(r.path), opts.resume)) {
          alreadyDone += 1;
          continue;
        }
        out.push(r);
        // Limit actual work, never the prefix of completed candidates.
        if (opts.limit && out.length >= opts.limit) return { rows: out, scanned, alreadyDone };
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  return { rows: out, scanned, alreadyDone };
}

async function loadExistingMap(
  admin: SupabaseClient
): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();

  // 경로 .in() 은 긴 한글·특수문자 URL 로 fetch 실패할 수 있음 → 전체 페이지 로드 후 필터
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await admin
      .from("nas_file_text")
      .select("path, drive, size_bytes, modified_at, content_hash, status, updated_at")
      .order("path")
      .range(from, from + page - 1);
    if (error) {
      throw new Error(
        `nas_file_text load: ${error.message || error.code || JSON.stringify(error)}`
      );
    }
    const rows = (data ?? []) as ExistingRow[];
    if (rows.length === 0) break;
    for (const r of rows) {
      map.set(r.path, r);
    }
    if (rows.length < page) break;
    from += page;
  }
  return map;
}

function needsWork(
  row: NasDirRow,
  existing: ExistingRow | undefined,
  resume: boolean
): boolean {
  if (!existing) return true;
  if (!resume) return true;
  // A failed attempt is not a completed extraction, even if the source is unchanged.
  if (!existing.status || existing.status === "failed") return true;
  if (existing.drive !== row.drive || row.size_bytes == null || existing.size_bytes == null ||
      Number(row.size_bytes) !== Number(existing.size_bytes)) return true;
  const fileMod = row.modified_at ? Date.parse(row.modified_at) : NaN;
  const dbMod = existing.modified_at ? Date.parse(existing.modified_at) : NaN;
  if (!Number.isFinite(fileMod) || !Number.isFinite(dbMod) || fileMod !== dbMod) {
    return true;
  }
  return false;
}

async function purgeMissingFiles(
  admin: SupabaseClient,
  batches: Map<string, string>
): Promise<number> {
  const live = new Set<string>();
  for (const drive of ["T", "P"]) {
    const batch = batches.get(drive);
    if (!batch) continue;
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("nas_directory")
        .select("path")
        .eq("type", "file")
        .eq("drive", drive)
        .eq("scan_batch", batch)
        .range(from, from + 999);
      if (error) throw error;
      const rows = data ?? [];
      for (const r of rows) {
        if (typeof r.path === "string") live.add(r.path);
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  let deleted = 0;
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("nas_file_text")
      .select("path")
      .order("path")
      .range(from, from + 999);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;
    const gone = rows
      .map((r) => r.path as string)
      .filter((p) => !live.has(p));
    for (const path of gone) {
      const { error: delErr } = await admin
        .from("nas_file_text")
        .delete()
        .eq("path", path);
      if (delErr) throw delErr;
      deleted += 1;
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return deleted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admin = createAdmin();

  const hasT = existsSync("T:\\");
  const hasP = existsSync("P:\\");
  console.log(`drives: T=${hasT} P=${hasP}`);
  if (!hasT && !hasP) {
    console.error(
      "T:/P: 없음. 회사 PC 대화형 세션에서 실행하세요 (schtasks /IT)."
    );
    process.exit(1);
  }

  const batches = await fetchLatestBatches(admin);
  console.log("scan_batch", Object.fromEntries(batches));

  if (args.purgeMissing && !args.dryRun) {
    const n = await purgeMissingFiles(admin, batches);
    console.log(`purge-missing deleted=${n}`);
  }

  // Existing metadata was already fully paginated by the old loader. Keep that
  // bounded-page read, then walk candidates until the actual work limit is filled.
  const existing = await loadExistingMap(admin);
  console.log("fetching candidates…");
  const candidates = await fetchCandidates(admin, args, batches, existing);
  const workQueue = candidates.rows;
  console.log(
    `to_process=${workQueue.length} scanned=${candidates.scanned} already_done=${candidates.alreadyDone} dryRun=${args.dryRun}`
  );

  if (args.dryRun) {
    const byExt: Record<string, number> = {};
    for (const c of workQueue) {
      const e = extOfNasPath(c.path) ?? "?";
      byExt[e] = (byExt[e] ?? 0) + 1;
    }
    console.log("dry-run by ext", byExt);
    return;
  }

  const runId = await startNasTextRun(admin, args.kind, workQueue.length);
  const progress: NasTextRunProgress = {
    targetCount: workQueue.length,
    ok: 0,
    empty: 0,
    failed: 0,
    skipped: 0,
    chunksCreated: 0,
    embeddingsCreated: 0,
    lastPath: null
  };

  const byExt: Record<
    string,
    { ok: number; empty: number; failed: number; skipped: number; chunks: number }
  > = {};
  let drawingSkipped = 0;
  const t0 = Date.now();

  const bump = (ext: string, key: keyof (typeof byExt)[string], n = 1) => {
    if (!byExt[ext]) {
      byExt[ext] = { ok: 0, empty: 0, failed: 0, skipped: 0, chunks: 0 };
    }
    byExt[ext]![key] += n;
  };

  try {
    for (let i = 0; i < workQueue.length; i++) {
      const row = workQueue[i]!;
      const ext = (extOfNasPath(row.path) ?? "pdf") as NasTextExt;
      progress.lastPath = row.path;
      const nowIso = new Date().toISOString();

      try {
        const prev = existing.get(row.path);
        if (prev && !prev.updated_at) throw new Error("Missing publication version");
        const meta: NasTextPublication = {
          path: row.path, drive: row.drive, ext,
          size_bytes: row.size_bytes, modified_at: row.modified_at,
          content_hash: null, text_length: 0, chunk_count: 0,
          status: "failed", skip_reason: null, error: "file_not_found", extracted_at: nowIso
        };
        let chunks: string[] = [];
        const full = resolveNasFullPath(row.drive, row.path);
        if (full) {
          const before = statSync(full);
          // Do not publish text for a physical version newer/older than the
          // directory snapshot. It must be scanned before it can be indexed.
          if (row.size_bytes !== before.size || !row.modified_at ||
              Date.parse(row.modified_at) !== before.mtime.getTime()) {
            throw new Error("Physical source differs from directory snapshot");
          }
          let extracted;
          try {
            extracted = await extractNasFileText(full, ext);
          } catch (error) {
            extracted = { status: "failed" as const, text: "", error: describeNasError(error, 400) };
          }
          const after = statSync(full);
          if (before.size !== after.size || before.mtime.getTime() !== after.mtime.getTime()) {
            throw new Error("Physical source changed during extraction");
          }
          meta.status = extracted.status;
          meta.error = extracted.status === "failed" ? (extracted.error ?? "extract_failed") : null;
          meta.skip_reason = extracted.status === "skipped" ? (extracted.skipReason ?? null) : null;
          if (extracted.status === "ok") {
            const cleanText = sanitizeNasText(extracted.text);
            const split = chunkNasText(cleanText);
            chunks = split.chunks;
            if (chunks.length === 0) {
              meta.status = "empty";
            } else {
              meta.content_hash = hashNasText(cleanText);
              meta.text_length = cleanText.length;
              meta.chunk_count = chunks.length;
              meta.skip_reason = split.truncated ? "truncated_200_chunks" : null;
            }
          }
        }
        const created = await publishNasText(admin, meta, chunks, prev?.updated_at ?? null);
        // Count each file once, only after the entire publication is acknowledged.
        progress[meta.status] += 1;
        bump(ext, meta.status);
        progress.chunksCreated += created;
        bump(ext, "chunks", created);
        if (meta.skip_reason === "drawing_pdf") drawingSkipped += 1;
      } catch (fileErr) {
        progress.failed += 1;
        bump(ext, "failed");
        console.warn(`fail ${row.path}: ${describeNasError(fileErr, 400)}`);
        // Never overwrite metadata after a failed/uncertain RPC. Its transaction
        // either preserved the previous file or committed a complete replacement.
      }

      if ((i + 1) % 25 === 0 || i + 1 === workQueue.length) {
        if (runId) await updateNasTextRunProgress(admin, runId, progress);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(
          `[${i + 1}/${workQueue.length}] ok=${progress.ok} empty=${progress.empty} skip=${progress.skipped} fail=${progress.failed} chunks=${progress.chunksCreated} ${elapsed}s`
        );
      }
    }

    // Keep successful files, but never report a partially failed run as done.
    if (progress.failed > 0) {
      throw new Error(`${progress.failed} file extractions failed`);
    }

    if (runId) {
      await finishNasTextRun(admin, runId, "done", progress);
    }
  } catch (e) {
    const msg = describeNasError(e);
    if (runId) await finishNasTextRun(admin, runId, "failed", progress, msg);
    throw e;
  }

  const elapsedMs = Date.now() - t0;
  console.log("\n=== done ===");
  console.log({
    processed: workQueue.length,
    ...progress,
    drawing_pdf_skipped: drawingSkipped,
    elapsed_sec: +(elapsedMs / 1000).toFixed(1),
    by_ext: byExt
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
