/**
 * Work서버 이미지 색인 — 회사 PC 전용.
 *
 *   npx tsx scripts/index-media.ts --dry-run
 *   npx tsx scripts/index-media.ts --limit=20
 *   npx tsx scripts/index-media.ts --limit=20 --model=claude-haiku-4-5 --compare
 *   npx tsx scripts/index-media.ts --root="T:\\02 Project\\2026"
 *
 * 또는 run-media-index.bat (작업 스케줄러용)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  contentHash,
  createEmbedding,
  embeddingToSql
} from "@/lib/luna/embedding";
import {
  loadImageMeta,
  makeThumbnail,
  resizeForVision
} from "@/lib/luna/media-image";
import {
  fetchIndexedMtime,
  upsertMediaIndex,
  type MediaIndexRow
} from "@/lib/luna/media-index-store";
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
  uploadMediaThumbnail
} from "@/lib/luna/media-thumbnails";
import {
  analyzeMediaImageVision,
  buildMediaIndexVisionPrompt,
  mediaVisionModel
} from "@/lib/luna/media-vision";
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
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    dryRun: false,
    limit: null,
    root: DEFAULT_PILOT_ROOT,
    model: null,
    compare: false
  };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--compare") opts.compare = true;
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
      description: string;
      category: string;
      visionIn: number;
      visionOut: number;
    }
  | { status: "skipped" }
  | { status: "failed" }
> {
  const existing = await fetchIndexedMtime(admin, item.path);
  if (isSameMtime(existing.mtime, item.mtimeMs)) {
    return { status: "skipped" };
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

  const prompt = buildMediaIndexVisionPrompt({
    fullPath: item.fullPath,
    parts,
    folderCategory: item.includeRule,
    glossary,
    notionContext
  });

  const dims = await loadImageMeta(item.fullPath);
  const jpegB64 = await resizeForVision(item.fullPath);
  if (!jpegB64) {
    console.error(`  [skip] image unreadable: ${item.path}`);
    return { status: "failed" };
  }

  let vision;
  try {
    vision = await analyzeMediaImageVision(jpegB64, prompt, {
      model: mediaVisionModel()
    });
  } catch (e) {
    console.error(`  [vision] ${item.path}:`, e instanceof Error ? e.message : e);
    return { status: "failed" };
  }

  const thumbBuf = await makeThumbnail(item.fullPath);
  let thumbnailUrl: string | null = null;
  if (thumbBuf) {
    try {
      const key = storageKeyFromPath(item.drive, item.path);
      thumbnailUrl = await uploadMediaThumbnail(admin, key, thumbBuf);
    } catch (e) {
      console.warn(`  [thumb] ${item.path}:`, e instanceof Error ? e.message : e);
    }
  }

  const embedText = [vision.result.description, vision.result.purpose]
    .filter(Boolean)
    .join("\n");
  const vector = await createEmbedding(embedText);
  const hash = contentHash(embedText);

  const row: MediaIndexRow = {
    path: item.path,
    drive: item.drive,
    file_name: item.fileName,
    file_type: mediaFileTypeFromExt(item.fullPath),
    file_size: item.sizeBytes,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
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
    embedding: vector ? embeddingToSql(vector) : null,
    content_hash: hash,
    indexed_at: new Date().toISOString()
  };

  await upsertMediaIndex(admin, row);
  return {
    status: "indexed",
    description: vision.result.description,
    category: vision.result.category,
    visionIn: vision.usage.inputTokens,
    visionOut: vision.usage.outputTokens
  };
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
      console.error(`  [missing] ${row.path}`);
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
        error: "file_not_found"
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
        error: "image_unreadable"
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
        error: e instanceof Error ? e.message.slice(0, 200) : "vision_error"
      };
      failed++;
      console.log("fail");
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
    work = sampleCandidatesByIncludeRule(stats.candidates, opts.limit);
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
  const samples: Array<{ file: string; category: string; description: string }> =
    [];

  for (let i = 0; i < work.length; i++) {
    const item = work[i]!;
    process.stdout.write(`[${i + 1}/${work.length}] ${item.fileName} … `);
    try {
      const r = await indexOne(admin, item, glossary, notionCache);
      if (r.status === "indexed") {
        indexed++;
        visionIn += r.visionIn;
        visionOut += r.visionOut;
        if (samples.length < 5 && r.description.trim()) {
          samples.push({
            file: item.fileName,
            category: r.category,
            description: r.description
          });
        }
        console.log("ok");
      } else if (r.status === "skipped") {
        skipped++;
        console.log("skip (mtime)");
      } else {
        failed++;
        console.log("fail");
      }
    } catch (e) {
      failed++;
      console.log("error:", e instanceof Error ? e.message : e);
    }
  }

  const model = mediaVisionModel();
  const price = resolveOfficialPrice(model);
  let estUsd: number | null = null;
  if (price) {
    estUsd =
      (visionIn / 1_000_000) * price.input +
      (visionOut / 1_000_000) * price.output;
  }

  console.log(`\ndone: indexed=${indexed} skipped=${skipped} failed=${failed}`);
  if (indexed > 0) {
    console.log(
      `vision tokens: in=${visionIn.toLocaleString("ko-KR")} out=${visionOut.toLocaleString("ko-KR")}`
    );
    if (estUsd != null) {
      console.log(`vision cost (est.): $${estUsd.toFixed(4)} (${model})`);
    }
    if (samples.length > 0) {
      console.log("\n--- description samples ---");
      for (const s of samples) {
        console.log(`[${s.category}] ${s.file}`);
        console.log(`  ${s.description}\n`);
      }
    }
  }
}

const opts = parseArgs(process.argv.slice(2));
runIndex(opts).catch((e) => {
  console.error(e);
  process.exit(1);
});
