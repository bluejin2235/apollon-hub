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
  path: string;
  drive: string;
  modified_at: string | null;
  content_hash: string | null;
  status: string;
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
  batches: Map<string, string>
): Promise<NasDirRow[]> {
  const out: NasDirRow[] = [];
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
        if (!r.path || isBackupPath(r.path)) continue;
        const e = extOfNasPath(r.path);
        if (!e) continue;
        if (opts.ext && e !== opts.ext) continue;
        out.push(r);
        if (opts.limit && out.length >= opts.limit * 3) {
          // 여유분 — 이어받기 스킵 후 limit 맞추기
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
      if (opts.limit && out.length >= opts.limit * 5) break;
    }
  }
  return out;
}

async function loadExistingMap(
  admin: SupabaseClient,
  paths: string[]
): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  if (paths.length === 0) return map;

  // 경로 .in() 은 긴 한글·특수문자 URL 로 fetch 실패할 수 있음 → 전체 페이지 로드 후 필터
  const wanted = new Set(paths);
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await admin
      .from("nas_file_text")
      .select("path, drive, modified_at, content_hash, status")
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
      if (wanted.has(r.path)) map.set(r.path, r);
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
  const fileMod = row.modified_at ? Date.parse(row.modified_at) : NaN;
  const dbMod = existing.modified_at ? Date.parse(existing.modified_at) : NaN;
  if (Number.isFinite(fileMod) && Number.isFinite(dbMod) && fileMod > dbMod) {
    return true;
  }
  return false;
}

async function deleteChunks(admin: SupabaseClient, path: string): Promise<void> {
  const { error } = await admin.from("nas_file_chunks").delete().eq("path", path);
  if (error) throw error;
}

async function upsertTextMeta(
  admin: SupabaseClient,
  row: {
    path: string;
    drive: string;
    ext: string;
    size_bytes: number | null;
    modified_at: string | null;
    content_hash: string | null;
    text_length: number;
    chunk_count: number;
    status: string;
    skip_reason: string | null;
    error: string | null;
    extracted_at: string;
  }
): Promise<void> {
  const { error } = await admin.from("nas_file_text").upsert(
    {
      ...row,
      updated_at: new Date().toISOString()
    },
    { onConflict: "path" }
  );
  if (error) throw error;
}

async function insertChunks(
  admin: SupabaseClient,
  path: string,
  chunks: string[]
): Promise<number> {
  if (chunks.length === 0) return 0;
  const rows = chunks.map((content, i) => ({
    path,
    seq: i,
    content: content.replace(/\u0000/g, "")
  }));
  const batch = 50;
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const part = rows.slice(i, i + batch);
    const { error } = await admin.from("nas_file_chunks").insert(part);
    if (error) throw error;
    n += part.length;
  }
  return n;
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

  console.log("fetching candidates…");
  const candidates = await fetchCandidates(admin, args, batches);
  console.log(`candidates raw=${candidates.length}`);

  const existing = await loadExistingMap(
    admin,
    (args.limit != null
      ? candidates.slice(0, Math.max(args.limit * 2, args.limit))
      : candidates
    ).map((c) => c.path)
  );

  const candidateSlice =
    args.limit != null
      ? candidates.slice(0, Math.max(args.limit * 2, args.limit))
      : candidates;

  const work = candidateSlice.filter((c) =>
    needsWork(c, existing.get(c.path), args.resume)
  );
  const workQueue =
    args.limit != null ? work.slice(0, args.limit) : work;
  console.log(
    `to_process=${workQueue.length} already_done=${candidateSlice.length - work.length} dryRun=${args.dryRun}`
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
      const full = resolveNasFullPath(row.drive, row.path);

      if (!full) {
        progress.failed += 1;
        bump(ext, "failed");
        await upsertTextMeta(admin, {
          path: row.path,
          drive: row.drive,
          ext,
          size_bytes: row.size_bytes,
          modified_at: row.modified_at,
          content_hash: null,
          text_length: 0,
          chunk_count: 0,
          status: "failed",
          skip_reason: null,
          error: "file_not_found",
          extracted_at: nowIso
        });
      } else {
        let sizeBytes = row.size_bytes;
        let modifiedAt = row.modified_at;
        try {
          const st = statSync(full);
          sizeBytes = st.size;
          modifiedAt = st.mtime.toISOString();
        } catch {
          /* keep nas row */
        }

        const extracted = await extractNasFileText(full, ext);
        const prev = existing.get(row.path);

        if (extracted.status === "skipped") {
          progress.skipped += 1;
          bump(ext, "skipped");
          if (extracted.skipReason === "drawing_pdf") drawingSkipped += 1;
          await upsertTextMeta(admin, {
            path: row.path,
            drive: row.drive,
            ext,
            size_bytes: sizeBytes,
            modified_at: modifiedAt,
            content_hash: null,
            text_length: 0,
            chunk_count: 0,
            status: "skipped",
            skip_reason: extracted.skipReason ?? null,
            error: extracted.error ?? null,
            extracted_at: nowIso
          });
        } else if (extracted.status === "empty") {
          progress.empty += 1;
          bump(ext, "empty");
          if (prev) await deleteChunks(admin, row.path);
          await upsertTextMeta(admin, {
            path: row.path,
            drive: row.drive,
            ext,
            size_bytes: sizeBytes,
            modified_at: modifiedAt,
            content_hash: null,
            text_length: 0,
            chunk_count: 0,
            status: "empty",
            skip_reason: null,
            error: null,
            extracted_at: nowIso
          });
        } else if (extracted.status === "failed") {
          progress.failed += 1;
          bump(ext, "failed");
          await upsertTextMeta(admin, {
            path: row.path,
            drive: row.drive,
            ext,
            size_bytes: sizeBytes,
            modified_at: modifiedAt,
            content_hash: null,
            text_length: 0,
            chunk_count: 0,
            status: "failed",
            skip_reason: null,
            error: extracted.error ?? "extract_failed",
            extracted_at: nowIso
          });
        } else {
          const cleanText = sanitizeNasText(extracted.text);
          const hash = hashNasText(cleanText);
          const { chunks, truncated } = chunkNasText(cleanText);

          if (prev?.content_hash === hash && prev.status === "ok") {
            // 본문 동일 — 청크·임베딩 유지, 메타만 갱신
            progress.ok += 1;
            bump(ext, "ok");
            await upsertTextMeta(admin, {
              path: row.path,
              drive: row.drive,
              ext,
              size_bytes: sizeBytes,
              modified_at: modifiedAt,
              content_hash: hash,
              text_length: cleanText.length,
              chunk_count: chunks.length,
              status: "ok",
              skip_reason: truncated ? "truncated_200_chunks" : null,
              error: null,
              extracted_at: nowIso
            });
          } else {
            await deleteChunks(admin, row.path);
            await upsertTextMeta(admin, {
              path: row.path,
              drive: row.drive,
              ext,
              size_bytes: sizeBytes,
              modified_at: modifiedAt,
              content_hash: hash,
              text_length: cleanText.length,
              chunk_count: chunks.length,
              status: "ok",
              skip_reason: truncated ? "truncated_200_chunks" : null,
              error: null,
              extracted_at: nowIso
            });
            const n = await insertChunks(admin, row.path, chunks);
            progress.chunksCreated += n;
            bump(ext, "chunks", n);
            progress.ok += 1;
            bump(ext, "ok");
          }
        }
      }
      } catch (fileErr) {
        progress.failed += 1;
        bump(ext, "failed");
        const msg =
          fileErr instanceof Error
            ? fileErr.message.slice(0, 400)
            : String(fileErr).slice(0, 400);
        console.warn(`fail ${row.path}: ${msg}`);
        try {
          await upsertTextMeta(admin, {
            path: row.path,
            drive: row.drive,
            ext,
            size_bytes: row.size_bytes,
            modified_at: row.modified_at,
            content_hash: null,
            text_length: 0,
            chunk_count: 0,
            status: "failed",
            skip_reason: null,
            error: msg,
            extracted_at: nowIso
          });
        } catch {
          /* meta 실패는 무시하고 다음 파일 */
        }
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
    const msg = e instanceof Error ? e.message : String(e);
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
