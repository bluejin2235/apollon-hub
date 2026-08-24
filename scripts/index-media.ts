/**
 * Work서버 이미지 색인 — 회사 PC 전용.
 *
 *   npx tsx scripts/index-media.ts --dry-run
 *   npx tsx scripts/index-media.ts --limit=20
 *   npx tsx scripts/index-media.ts --limit=20 --model=claude-haiku-4-5 --compare
 *   npx tsx scripts/index-media.ts --root="T:\\02 Project\\2026"
 *
 *   npx tsx scripts/index-media.ts --rebuild-large
 *
 * 또는 run-media-index.bat (작업 스케줄러용)
 *   scripts/register-rebuild-large-task.ps1 — 142장 large_url 일회성 (/IT)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  contentHash,
  createEmbedding,
  embeddingToSql
} from "@/lib/luna/embedding";
import {
  loadImageMeta,
  makeLargeWebp,
  renderMediaVariants,
  resizeForVision
} from "@/lib/luna/media-image";
import {
  fetchIndexedMtime,
  fetchMediaIndexForLargeRebuild,
  updateMediaLargeUrl,
  upsertMediaIndex,
  type MediaIndexRow
} from "@/lib/luna/media-index-store";
import { THUMB_BUCKET } from "@/lib/luna/media-index-rules";
import {
  collectMediaCandidates,
  DEFAULT_PILOT_ROOT,
  mediaFileTypeFromExt,
  printMediaDryRunReport,
  sampleCandidatesByIncludeRule,
  writeMediaDryRunJson,
  type ScanCandidate
} from "@/lib/luna/media-scan";
import { parseMediaPath } from "@/lib/luna/media-path-parse";
import { resolveOfficialPrice } from "@/lib/luna/model-pricing";
import {
  storageKeyFromPath,
  uploadMediaLarge,
  uploadMediaThumbnail
} from "@/lib/luna/media-thumbnails";
import {
  analyzeMediaImageVision,
  buildMediaIndexVisionPrompt,
  mediaVisionModel,
  resolveMediaVisionProvider
} from "@/lib/luna/media-vision";
import {
  lunaAnthropicApiKey,
  lunaOpenAiApiKey
} from "@/lib/luna/media-vision-api";
import {
  compareHtmlPath,
  compareJsonPath,
  countGlossaryTermsInText,
  fetchIndexedCompareRows,
  loadCompareDoc,
  mergeCompareModelRun,
  printCompareReport,
  resolveMediaFilePath,
  saveCompareDoc,
  seedCompareDocFromIndex,
  visionCostUsd,
  writeCompareHtml,
  type CompareModelResult,
  type MediaModelCompareDoc
} from "@/lib/luna/media-model-compare";
import {
  loadNotionProjectContexts,
  loadVisualGlossary
} from "@/lib/luna/media-vision-prompt";

type CliOpts = {
  dryRun: boolean;
  limit: number | null;
  root: string;
  model: string | null;
  compare: boolean;
  rebuildLarge: boolean;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    dryRun: false,
    limit: null,
    root: DEFAULT_PILOT_ROOT,
    model: null,
    compare: false,
    rebuildLarge: false
  };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--compare") opts.compare = true;
    else if (a === "--rebuild-large") opts.rebuildLarge = true;
    else if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    } else if (a.startsWith("--root=")) {
      opts.root = a.slice("--root=".length).replace(/^["']|["']$/g, "");
    } else if (a.startsWith("--model=")) {
      opts.model = a.slice("--model=".length).replace(/^["']|["']$/g, "");
    }
  }
  return opts;
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

/** T:/P: 미연결 시 SCAN_UNC_T / SCAN_UNC_P 폴백 (읽기만) */
function resolveScanRoot(rootArg: string): string {
  if (existsSync(rootArg)) return rootArg;

  const drive = rootArg.match(/^([A-Za-z]):/)?.[1]?.toUpperCase();
  const unc =
    drive === "P"
      ? process.env.SCAN_UNC_P?.trim()
      : process.env.SCAN_UNC_T?.trim();

  if (unc && drive) {
    const rel = rootArg.replace(/^[A-Za-z]:\\/i, "").replace(/^\\+/, "");
    const uncRoot = join(unc.replace(/\\+$/, ""), rel);
    if (existsSync(uncRoot)) {
      console.log(`[root] ${drive}: unavailable → ${uncRoot}`);
      return uncRoot;
    }
  }

  return rootArg;
}

function mtimeIso(ms: number): string {
  return new Date(ms).toISOString();
}

function isSameMtime(stored: string | null, ms: number): boolean {
  if (!stored) return false;
  return Math.abs(new Date(stored).getTime() - ms) < 1000;
}

async function indexOne(
  admin: SupabaseClient,
  item: ScanCandidate,
  glossary: Awaited<ReturnType<typeof loadVisualGlossary>>,
  notionCache: Map<string, string | null>
): Promise<
  | {
      status: "indexed";
      path: string;
      drive: string;
      project: string | null;
      folderCategory: string;
      description: string;
      purpose: string;
      category: string;
      termsUsed: string[];
      thumbnailUrl: string | null;
      notionMatched: boolean;
      visionIn: number;
      visionOut: number;
    }
  | { status: "skipped"; reason: "mtime" }
  | { status: "failed"; reason: string }
> {
  const existing = await fetchIndexedMtime(admin, item.path);
  if (isSameMtime(existing.mtime, item.mtimeMs)) {
    return { status: "skipped", reason: "mtime" };
  }

  const parts = parseMediaPath(item.fullPath);
  const stage =
    parts.stageName != null
      ? `${parts.stageCode ?? ""} ${parts.stageName}`.trim()
      : null;

  const cacheKey = parts.project ?? "";
  let notionContext = notionCache.get(cacheKey);
  if (notionContext === undefined) {
    notionContext = parts.project
      ? await loadNotionProjectContexts(admin, parts.project)
      : null;
    notionCache.set(cacheKey, notionContext);
  }
  const notionMatched = Boolean(notionContext?.trim());

  const prompt = buildMediaIndexVisionPrompt({
    fullPath: item.fullPath,
    parts,
    folderCategory: item.includeRule,
    glossary,
    notionContext
  });

  const dims = await loadImageMeta(item.fullPath);
  const variants = await renderMediaVariants(item.fullPath);
  const jpegB64 = variants.visionJpegBase64;
  if (!jpegB64) {
    const ext = item.fileName.split(".").pop()?.toLowerCase() ?? "";
    // sharp/libvips 가 psd·ai 를 못 읽는 경우가 많음 — 전체 색인 지연 없이 건너뜀
    if (ext === "psd" || ext === "ai") {
      return { status: "failed", reason: `${ext}_unreadable` };
    }
    return { status: "failed", reason: "image_unreadable" };
  }

  let vision;
  try {
    vision = await analyzeMediaImageVision(jpegB64, prompt, {
      model: mediaVisionModel()
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", reason: `vision_error: ${msg.slice(0, 200)}` };
  }

  const storageKey = storageKeyFromPath(item.drive, item.path);
  let thumbnailUrl: string | null = null;
  if (variants.thumbWebp) {
    try {
      thumbnailUrl = await uploadMediaThumbnail(
        admin,
        storageKey,
        variants.thumbWebp
      );
    } catch (e) {
      console.warn(`  [thumb] ${item.path}:`, e instanceof Error ? e.message : e);
    }
  }

  let largeUrl: string | null = null;
  if (variants.largeWebp) {
    try {
      largeUrl = await uploadMediaLarge(admin, storageKey, variants.largeWebp);
    } catch (e) {
      console.warn(`  [large] ${item.path}:`, e instanceof Error ? e.message : e);
    }
  }

  const resolvedDims = variants.dims ?? dims;

  const embedText = [vision.result.description, vision.result.purpose]
    .filter(Boolean)
    .join("\n");
  const vector = await createEmbedding(embedText);
  const hash = contentHash(embedText);
  const termsUsed = countGlossaryTermsInText(embedText, glossary);

  const row: MediaIndexRow = {
    path: item.path,
    drive: item.drive,
    file_name: item.fileName,
    file_type: mediaFileTypeFromExt(item.fullPath),
    file_size: item.sizeBytes,
    width: resolvedDims?.width ?? null,
    height: resolvedDims?.height ?? null,
    file_mtime: mtimeIso(item.mtimeMs),
    project: parts.project,
    stage,
    author: vision.result.author || parts.actor,
    folder_category: item.includeRule,
    ai_category: vision.result.category,
    purpose: vision.result.purpose || null,
    description: vision.result.description || null,
    description_model: mediaVisionModel(),
    thumbnail_url: thumbnailUrl,
    large_url: largeUrl,
    embedding: vector ? embeddingToSql(vector) : null,
    content_hash: hash,
    indexed_at: new Date().toISOString()
  };

  await upsertMediaIndex(admin, row);
  return {
    status: "indexed",
    path: item.path,
    drive: item.drive,
    project: parts.project,
    folderCategory: item.includeRule,
    description: vision.result.description,
    purpose: vision.result.purpose,
    category: vision.result.category,
    termsUsed,
    thumbnailUrl,
    notionMatched,
    visionIn: vision.usage.inputTokens,
    visionOut: vision.usage.outputTokens
  };
}

const SCALE_TOTAL = 2230;

function parentFolder(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
}

function printBatchReport(opts: {
  indexed: number;
  skipped: number;
  failed: number;
  failReasons: Record<string, number>;
  visionIn: number;
  visionOut: number;
  elapsedMs: number;
  model: string;
  estUsd: number | null;
  rows: Array<{
    path: string;
    drive: string;
    project: string | null;
    folderCategory: string;
    category: string;
    description: string;
    purpose: string;
    termsUsed: string[];
    thumbnailUrl: string | null;
    notionMatched: boolean;
  }>;
}): void {
  const byCat: Record<string, number> = {
    ours: 0,
    reference: 0,
    document: 0,
    unknown: 0
  };
  const byProject: Record<string, number> = {};
  const byFolder: Record<string, number> = {};
  let notionHits = 0;

  for (const r of opts.rows) {
    const cat = r.category in byCat ? r.category : "unknown";
    byCat[cat] += 1;
    const proj = r.project ?? "(none)";
    byProject[proj] = (byProject[proj] ?? 0) + 1;
    const folder = parentFolder(r.path);
    byFolder[folder] = (byFolder[folder] ?? 0) + 1;
    if (r.notionMatched) notionHits += 1;
  }

  const thumbSamples = opts.rows
    .filter((r) => r.thumbnailUrl)
    .slice(0, 3)
    .map((r) => r.thumbnailUrl!);
  const pathSamples = opts.rows.slice(0, 3).map((r) => r.path);
  const descSamples = opts.rows.slice(0, 5);

  console.log("\n=== batch report ===");
  console.log(`1. 성공 ${opts.indexed} · skip ${opts.skipped} · 실패 ${opts.failed}`);
  if (Object.keys(opts.failReasons).length > 0) {
    for (const [k, v] of Object.entries(opts.failReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`   - ${k}: ${v}`);
    }
  }
  console.log(
    `2. 비용: in=${opts.visionIn.toLocaleString("ko-KR")} out=${opts.visionOut.toLocaleString("ko-KR")}` +
      (opts.estUsd != null ? ` · $${opts.estUsd.toFixed(4)} (${opts.model})` : "")
  );
  console.log(`3. 소요: ${(opts.elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `4. 분류: ours=${byCat.ours} reference=${byCat.reference} document=${byCat.document} unknown=${byCat.unknown}`
  );
  console.log("5. 프로젝트별:");
  for (const [k, v] of Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`   ${k}: ${v}`);
  }
  console.log("   폴더별 (상위 8):");
  for (const [k, v] of Object.entries(byFolder).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`   ${k}: ${v}`);
  }
  console.log(`6. 썸네일 Storage: ${thumbSamples.length}/${opts.indexed} 샘플`);
  for (const u of thumbSamples) console.log(`   ${u}`);
  console.log("7. path (드라이브 없음) 샘플:");
  for (const p of pathSamples) console.log(`   ${p}`);
  console.log(
    `8. 노션 맥락: ${notionHits}/${opts.indexed} (${opts.indexed > 0 ? ((100 * notionHits) / opts.indexed).toFixed(1) : 0}%)`
  );
  console.log("9. 설명 샘플:");
  for (const s of descSamples) {
    console.log(`   [${s.category}] ${s.path}`);
    console.log(`   용어: ${s.termsUsed.length > 0 ? s.termsUsed.join(", ") : "(없음)"}`);
    console.log(`   ${s.description.slice(0, 160)}…`);
  }
  if (opts.indexed > 0 && opts.estUsd != null) {
    const perImg = opts.estUsd / opts.indexed;
    const perSec = opts.elapsedMs / opts.indexed / 1000;
    console.log(
      `10. ${SCALE_TOTAL.toLocaleString("ko-KR")}장 예상: $${(perImg * SCALE_TOTAL).toFixed(2)} · ${((perSec * SCALE_TOTAL) / 3600).toFixed(1)}h`
    );
  }
}

const SCALE_LARGE_CORPUS = 77065;

async function walkStorageFiles(
  admin: SupabaseClient,
  prefix = ""
): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  let offset = 0;
  const page = 200;
  while (true) {
    const { data, error } = await admin.storage.from(THUMB_BUCKET).list(prefix, {
      limit: page,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const name = row.name ?? "";
      const childPrefix = prefix ? `${prefix}/${name}` : name;
      if (row.id == null) {
        out.push(...(await walkStorageFiles(admin, childPrefix)));
      } else {
        const meta = row.metadata as { size?: number } | undefined;
        out.push({
          path: childPrefix,
          size: typeof meta?.size === "number" ? meta.size : 0
        });
      }
    }
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

async function summarizeStorage(admin: SupabaseClient): Promise<{
  thumbCount: number;
  thumbBytes: number;
  largeCount: number;
  largeBytes: number;
}> {
  const files = await walkStorageFiles(admin);
  let thumbCount = 0;
  let thumbBytes = 0;
  let largeCount = 0;
  let largeBytes = 0;
  for (const f of files) {
    if (f.path.endsWith(".large.webp")) {
      largeCount += 1;
      largeBytes += f.size;
    } else if (f.path.endsWith(".webp")) {
      thumbCount += 1;
      thumbBytes += f.size;
    }
  }
  return { thumbCount, thumbBytes, largeCount, largeBytes };
}

function printRebuildLargeReport(opts: {
  elapsedMs: number;
  ok: number;
  skipped: number;
  failed: number;
  failReasons: Record<string, number>;
  thumbBytes: number;
  thumbCount: number;
  largeBytes: number;
  largeCount: number;
  filledLargeUrl: number;
  under1200: number;
  totalRows: number;
}): void {
  const thumbMb = opts.thumbBytes / (1024 * 1024);
  const largeMb = opts.largeBytes / (1024 * 1024);
  const avgThumb = opts.thumbCount > 0 ? opts.thumbBytes / opts.thumbCount : 0;
  const avgLarge = opts.largeCount > 0 ? opts.largeBytes / opts.largeCount : 0;
  const estThumbGb = (avgThumb * SCALE_LARGE_CORPUS) / (1024 ** 3);
  const estLargeGb = (avgLarge * SCALE_LARGE_CORPUS) / (1024 ** 3);

  console.log("\n=== rebuild-large report ===");
  console.log(
    `1. 소요: ${(opts.elapsedMs / 1000).toFixed(1)}s · ok=${opts.ok} skip=${opts.skipped} fail=${opts.failed}`
  );
  if (Object.keys(opts.failReasons).length > 0) {
    for (const [k, v] of Object.entries(opts.failReasons).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`   fail ${k}: ${v}`);
    }
  }
  console.log(
    `2. large_url 채움: ${opts.filledLargeUrl}/${opts.totalRows} (이번 실행 ok=${opts.ok})`
  );
  console.log(
    `3. Storage 썸네일(.webp): ${opts.thumbCount} files · ${thumbMb.toFixed(2)} MB`
  );
  console.log(
    `4. Storage 확대본(.large.webp): ${opts.largeCount} files · ${largeMb.toFixed(2)} MB`
  );
  console.log(
    `5. 원본 긴 변 < 1200px: ${opts.under1200}/${opts.totalRows}`
  );
  console.log(
    `6. ${SCALE_LARGE_CORPUS.toLocaleString("ko-KR")}장 예상 Storage: 썸네일 ${estThumbGb.toFixed(2)} GB + 확대본 ${estLargeGb.toFixed(2)} GB = ${(estThumbGb + estLargeGb).toFixed(2)} GB`
  );
}

async function runRebuildLarge(admin: SupabaseClient): Promise<void> {
  const rows = await fetchMediaIndexForLargeRebuild(admin);
  if (rows.length === 0) {
    console.log("luna_media_index: no rows");
    return;
  }

  const need = rows.filter((r) => !r.large_url?.trim());
  console.log(
    `rebuild-large: ${need.length} to process (${rows.length} total, ${rows.length - need.length} already have large_url)`
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const failReasons: Record<string, number> = {};
  let largeBytesUploaded = 0;
  const t0 = Date.now();

  for (let i = 0; i < need.length; i++) {
    const row = need[i]!;
    const fullPath = resolveMediaFilePath(row.drive, row.path);
    if (!existsSync(fullPath)) {
      failed++;
      failReasons.file_not_found = (failReasons.file_not_found ?? 0) + 1;
      console.log(`[${i + 1}/${need.length}] skip missing ${row.path}`);
      continue;
    }

    process.stdout.write(
      `[${i + 1}/${need.length}] ${basename(row.path)} … `
    );
    try {
      const buf = await makeLargeWebp(fullPath);
      if (!buf) {
        failed++;
        failReasons.image_unreadable = (failReasons.image_unreadable ?? 0) + 1;
        console.log("fail (unreadable)");
        continue;
      }
      const key = storageKeyFromPath(row.drive, row.path);
      const largeUrl = await uploadMediaLarge(admin, key, buf);
      await updateMediaLargeUrl(admin, row.path, largeUrl);
      largeBytesUploaded += buf.length;
      ok++;
      console.log(`ok ${buf.length}B`);
    } catch (e) {
      failed++;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      failReasons[msg] = (failReasons[msg] ?? 0) + 1;
      console.log(`error: ${msg}`);
    }
  }

  skipped = rows.length - need.length;
  const elapsedMs = Date.now() - t0;

  const { data: filledRows, error: filledErr } = await admin
    .from("luna_media_index")
    .select("large_url, width, height")
    .not("large_url", "is", null);
  if (filledErr) throw filledErr;

  const filledLargeUrl = (filledRows ?? []).length;
  let under1200 = 0;
  for (const r of rows) {
    const w = typeof r.width === "number" ? r.width : 0;
    const h = typeof r.height === "number" ? r.height : 0;
    const maxSide = Math.max(w, h);
    if (maxSide > 0 && maxSide < 1200) under1200 += 1;
  }

  let thumbStats = { count: 0, bytes: 0 };
  let largeStats = { count: 0, bytes: 0 };
  try {
    const storage = await summarizeStorage(admin);
    thumbStats = { count: storage.thumbCount, bytes: storage.thumbBytes };
    largeStats = { count: storage.largeCount, bytes: storage.largeBytes };
  } catch (e) {
    console.warn("[storage list]", e instanceof Error ? e.message : e);
    largeStats = { count: ok, bytes: largeBytesUploaded };
  }

  printRebuildLargeReport({
    elapsedMs,
    ok,
    skipped,
    failed,
    failReasons,
    thumbBytes: thumbStats.bytes,
    thumbCount: thumbStats.count,
    largeBytes: largeStats.bytes,
    largeCount: largeStats.count,
    filledLargeUrl,
    under1200,
    totalRows: rows.length
  });
}

async function runCompare(opts: CliOpts): Promise<void> {
  const limit = opts.limit ?? 20;
  const model = opts.model;
  if (!model) {
    console.error("--compare requires --model=...");
    process.exit(1);
  }

  const admin = createAdmin();
  const glossary = await loadVisualGlossary(admin);
  console.log(`compare model: ${model} · files: ${limit}`);
  if (resolveMediaVisionProvider(model) === "anthropic") {
    const ak = lunaAnthropicApiKey();
    console.log(
      `anthropic key: ${ak ? "ok (hubtrendchat_claude / ANTHROPIC_API_KEY)" : "MISSING"}`
    );
    if (!ak) process.exit(1);
  } else {
    const ok = lunaOpenAiApiKey();
    console.log(`openai key: ${ok ? "ok" : "MISSING"}`);
    if (!ok) process.exit(1);
  }

  let doc = loadCompareDoc();
  if (!doc || doc.files.length === 0) {
    const indexed = await fetchIndexedCompareRows(admin, limit);
    if (indexed.length === 0) {
      console.error("luna_media_index 에 색인된 행이 없습니다. 먼저 --limit=20 으로 색인하세요.");
      process.exit(1);
    }
    if (indexed.length < limit) {
      console.warn(`index rows ${indexed.length} < limit ${limit}`);
    }
    doc = seedCompareDocFromIndex(indexed, glossary);
    console.log(`seeded ${doc.files.length} files from luna_media_index`);
  } else if (doc.files.length > limit) {
    doc.files = doc.files.slice(0, limit);
  }

  const notionCache = new Map<string, string | null>();
  let visionIn = 0;
  let visionOut = 0;
  let elapsedMs = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < doc.files.length; i++) {
    const row = doc.files[i]!;
    const existing = row.models[model];
    if (existing?.description && !existing.error) {
      skipped++;
      continue;
    }

    const indexed = await admin
      .from("luna_media_index")
      .select("drive, folder_category")
      .eq("path", row.path)
      .maybeSingle();
    const drive = (indexed.data?.drive as string) ?? "T";
    const folderCategory =
      row.folder_category ?? (indexed.data?.folder_category as string) ?? "";

    const fullPath = resolveMediaFilePath(drive, row.path);
    if (!existsSync(fullPath)) {
      const errMsg = `file_not_found: ${fullPath}`;
      console.error(`  [${i + 1}/${doc.files.length}] ${errMsg}`);
      row.models[model] = {
        description: "",
        category: "unknown",
        purpose: "",
        author: "",
        terms_used: [],
        input_tokens: 0,
        output_tokens: 0,
        elapsed_ms: 0,
        cost_usd: null,
        error: errMsg
      };
      failed++;
      continue;
    }

    const parts = parseMediaPath(fullPath);
    const cacheKey = parts.project ?? "";
    let notionContext = notionCache.get(cacheKey);
    if (notionContext === undefined) {
      notionContext = parts.project
        ? await loadNotionProjectContexts(admin, parts.project)
        : null;
      notionCache.set(cacheKey, notionContext);
    }

    const prompt = buildMediaIndexVisionPrompt({
      fullPath,
      parts,
      folderCategory,
      glossary,
      notionContext
    });

    const jpegB64 = await resizeForVision(fullPath);
    if (!jpegB64) {
      const errMsg = `image_unreadable: ${fullPath}`;
      console.error(`  [${i + 1}/${doc.files.length}] ${errMsg}`);
      row.models[model] = {
        description: "",
        category: "unknown",
        purpose: "",
        author: "",
        terms_used: [],
        input_tokens: 0,
        output_tokens: 0,
        elapsed_ms: 0,
        cost_usd: null,
        error: errMsg
      };
      failed++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${doc.files.length}] ${row.file_name} … `);
    const t0 = Date.now();
    try {
      const vision = await analyzeMediaImageVision(jpegB64, prompt, { model });
      const ms = Date.now() - t0;
      const text = [vision.result.description, vision.result.purpose]
        .filter(Boolean)
        .join("\n");
      const result: CompareModelResult = {
        description: vision.result.description,
        category: vision.result.category,
        purpose: vision.result.purpose,
        author: vision.result.author,
        terms_used: countGlossaryTermsInText(text, glossary),
        input_tokens: vision.usage.inputTokens,
        output_tokens: vision.usage.outputTokens,
        elapsed_ms: ms,
        cost_usd: visionCostUsd(
          model,
          vision.usage.inputTokens,
          vision.usage.outputTokens
        )
      };
      row.models[model] = result;
      visionIn += vision.usage.inputTokens;
      visionOut += vision.usage.outputTokens;
      elapsedMs += ms;
      ok++;
      console.log("ok");
    } catch (e) {
      const ms = Date.now() - t0;
      elapsedMs += ms;
      const errMsg =
        e instanceof Error ? e.message : `vision_error: ${String(e)}`;
      row.models[model] = {
        description: "",
        category: "unknown",
        purpose: "",
        author: "",
        terms_used: [],
        input_tokens: 0,
        output_tokens: 0,
        elapsed_ms: ms,
        cost_usd: null,
        error: errMsg.slice(0, 500)
      };
      failed++;
      console.error(`fail — ${errMsg.slice(0, 400)}`);
    }
  }

  if (ok > 0) {
    const totalCost = visionCostUsd(model, visionIn, visionOut);
    mergeCompareModelRun(doc, {
      model_id: model,
      file_count: ok,
      total_input_tokens: visionIn,
      total_output_tokens: visionOut,
      total_elapsed_ms: elapsedMs,
      total_cost_usd: totalCost,
      per_image_cost_usd: totalCost != null ? totalCost / ok : null,
      ran_at: new Date().toISOString()
    });
  }

  saveCompareDoc(doc);
  const html = writeCompareHtml(doc);
  console.log(`\ncompare done: ok=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`JSON: ${compareJsonPath()}`);
  console.log(`HTML: ${html}`);
  printCompareReport(doc);
}

async function runIndex(opts: CliOpts): Promise<void> {
  if (opts.compare) {
    await runCompare(opts);
    return;
  }
  if (opts.rebuildLarge) {
    const admin = createAdmin();
    await runRebuildLarge(admin);
    return;
  }
  const root = resolveScanRoot(opts.root);
  if (!existsSync(root)) {
    console.error(`root not found: ${root}`);
    console.error(
      "회사 PC에서 T:/P: 또는 SCAN_UNC_T=\\\\aiw\\work · SCAN_UNC_P=\\\\aiw\\partners 확인"
    );
    process.exit(1);
  }

  console.log(`scan root: ${root}`);
  const stats = collectMediaCandidates(root);

  if (opts.dryRun) {
    printMediaDryRunReport(stats, root);
    const out = writeMediaDryRunJson(stats, root, join(process.cwd(), "tmp"));
    console.log(`JSON: ${out}`);
    return;
  }

  const admin = createAdmin();
  const glossary = await loadVisualGlossary(admin);
  console.log(`glossary: ${glossary.length} terms · model: ${mediaVisionModel()}`);

  let work = stats.candidates;
  if (opts.limit != null) {
    work = sampleCandidatesByIncludeRule(stats.candidates, opts.limit, {
      maxPerFolder: 10
    });
    const byRule: Record<string, number> = {};
    for (const c of work) {
      byRule[c.includeRule] = (byRule[c.includeRule] ?? 0) + 1;
    }
    console.log(
      `limit sample (${work.length}): ${Object.entries(byRule)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
  }

  console.log(`indexing ${work.length} / ${stats.candidates.length} candidates`);

  const notionCache = new Map<string, string | null>();
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let visionIn = 0;
  let visionOut = 0;
  const failReasons: Record<string, number> = {};
  const indexedRows: Array<{
    path: string;
    drive: string;
    project: string | null;
    folderCategory: string;
    category: string;
    description: string;
    purpose: string;
    termsUsed: string[];
    thumbnailUrl: string | null;
    notionMatched: boolean;
  }> = [];
  const tBatch = Date.now();
  const model = mediaVisionModel();
  const price = resolveOfficialPrice(model);

  function runningCostUsd(): number | null {
    if (!price) return null;
    return (
      (visionIn / 1_000_000) * price.input +
      (visionOut / 1_000_000) * price.output
    );
  }

  for (let i = 0; i < work.length; i++) {
    const item = work[i]!;
    process.stdout.write(`[${i + 1}/${work.length}] ${item.fileName} … `);
    try {
      const r = await indexOne(admin, item, glossary, notionCache);
      if (r.status === "indexed") {
        indexed++;
        visionIn += r.visionIn;
        visionOut += r.visionOut;
        indexedRows.push({
          path: r.path,
          drive: r.drive,
          project: r.project,
          folderCategory: r.folderCategory,
          category: r.category,
          description: r.description,
          purpose: r.purpose,
          termsUsed: r.termsUsed,
          thumbnailUrl: r.thumbnailUrl,
          notionMatched: r.notionMatched
        });
        console.log("ok");
      } else if (r.status === "skipped") {
        skipped++;
        console.log("skip (mtime)");
      } else {
        failed++;
        failReasons[r.reason] = (failReasons[r.reason] ?? 0) + 1;
        console.log(`fail (${r.reason})`);
      }
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message : String(e);
      failReasons[reason.slice(0, 120)] = (failReasons[reason.slice(0, 120)] ?? 0) + 1;
      console.log("error:", reason);
    }

    const done = i + 1;
    if (done % 100 === 0 || done === work.length) {
      const elapsed = Date.now() - tBatch;
      const remaining = work.length - done;
      const etaMs = done > 0 ? (elapsed / done) * remaining : 0;
      const cost = runningCostUsd();
      const pct = ((100 * done) / work.length).toFixed(1);
      console.log(
        `[progress] ${done}/${work.length} (${pct}%) · ok=${indexed} skip=${skipped} fail=${failed}` +
          ` · cost=$${cost != null ? cost.toFixed(4) : "?"}` +
          ` · in=${visionIn.toLocaleString("ko-KR")} out=${visionOut.toLocaleString("ko-KR")}` +
          ` · elapsed=${(elapsed / 1000 / 60).toFixed(1)}m` +
          ` · eta≈${(etaMs / 1000 / 60).toFixed(1)}m`
      );
    }
  }

  const elapsedMs = Date.now() - tBatch;
  let estUsd: number | null = runningCostUsd();

  console.log(`\ndone: indexed=${indexed} skipped=${skipped} failed=${failed}`);
  if (indexed > 0 || failed > 0 || skipped > 0) {
    printBatchReport({
      indexed,
      skipped,
      failed,
      failReasons,
      visionIn,
      visionOut,
      elapsedMs,
      model,
      estUsd,
      rows: indexedRows
    });
  }

  try {
    const storage = await summarizeStorage(admin);
    const thumbMb = storage.thumbBytes / (1024 * 1024);
    const largeMb = storage.largeBytes / (1024 * 1024);
    console.log(
      `Storage: thumb ${storage.thumbCount} · ${thumbMb.toFixed(2)} MB · large ${storage.largeCount} · ${largeMb.toFixed(2)} MB`
    );
    if (indexed > 0 && estUsd != null && elapsedMs > 0) {
      const perImgUsd = estUsd / indexed;
      const perImgSec = elapsedMs / indexed / 1000;
      console.log(
        `${SCALE_LARGE_CORPUS.toLocaleString("ko-KR")}장 전체 색인 예상: $${(perImgUsd * SCALE_LARGE_CORPUS).toFixed(2)} · ${((perImgSec * SCALE_LARGE_CORPUS) / 3600).toFixed(1)}h`
      );
    }
  } catch (e) {
    console.warn(
      "Storage summary failed:",
      e instanceof Error ? e.message : e
    );
  }
}

const opts = parseArgs(process.argv.slice(2));
runIndex(opts).catch((e) => {
  console.error(e);
  process.exit(1);
});
