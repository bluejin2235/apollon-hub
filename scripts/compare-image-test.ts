/**
 * docs/image_test 로컬 이미지 × 비전 모델 비교
 *
 *   npx tsx scripts/compare-image-test.ts
 *   npx tsx scripts/compare-image-test.ts --model=claude-haiku-4-5
 *
 * DB·Storage 미사용.
 *   compare.json · compare.html — 3모델 전체
 *   compare-haiku-v2.json · compare-haiku-v2.html — haiku before/after (단일 모드)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resizeForVision } from "@/lib/luna/media-image";
import {
  COMPARE_MODEL_ORDER,
  countGlossaryTermsInText,
  visionCostUsd
} from "@/lib/luna/media-model-compare";
import {
  analyzeMediaImageVision,
  buildLocalImageTestVisionPrompt,
  resolveMediaVisionProvider
} from "@/lib/luna/media-vision";
import {
  lunaAnthropicApiKey,
  lunaOpenAiApiKey
} from "@/lib/luna/media-vision-api";
import { loadVisualGlossary } from "@/lib/luna/media-vision-prompt";

const IMAGE_DIR = join(process.cwd(), "docs", "image_test");
const SCALE_TOTAL = 2230;
const VISION_MAX_TOKENS = 1024;
const HAIKU_MODEL = "claude-haiku-4-5";

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".jfif",
  ".heic"
]);

const SKIP_NAMES = new Set([
  "compare.json",
  "compare.html",
  "compare-haiku-v2.json",
  "compare-haiku-v2.html"
]);

type ModelResult = {
  description: string;
  category: string;
  purpose: string;
  terms_used: string[];
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
  cost_usd: number | null;
  error?: string;
};

type FileRow = {
  file_name: string;
  relative_path: string;
  models: Record<string, ModelResult>;
};

type ModelRun = {
  model_id: string;
  file_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_elapsed_ms: number;
  total_cost_usd: number | null;
  per_image_cost_usd: number | null;
  terms_total: number;
  terms_avg: number;
};

type CompareDoc = {
  generated_at: string;
  image_dir: string;
  file_count: number;
  scale_total: number;
  vision_max_tokens: number;
  prompt_version?: string;
  model_runs: ModelRun[];
  files: FileRow[];
};

type ValidationStats = {
  gonggaegongji: number;
  terms_over_2: number;
  guess_phrases: number;
  unknown_category: number;
};

function parseArgs(argv: string[]): { model: string | null } {
  let model: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--model=")) {
      model = a.slice("--model=".length).replace(/^["']|["']$/g, "");
    }
  }
  return { model };
}

function collectImages(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (SKIP_NAMES.has(name)) return false;
      const ext = extname(name).toLowerCase();
      return IMAGE_EXTS.has(ext);
    })
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => join(dir, name));
}

function loadCompareDoc(fileName: string): CompareDoc | null {
  const path = join(IMAGE_DIR, fileName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CompareDoc;
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function encodeRelPath(fileName: string): string {
  return fileName
    .split(/[/\\]/)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function validateHaiku(files: FileRow[], model: string): ValidationStats {
  const stats: ValidationStats = {
    gonggaegongji: 0,
    terms_over_2: 0,
    guess_phrases: 0,
    unknown_category: 0
  };
  const guessRe = /추정|보인다|보임|것으로 보|으로 보|추측/;
  for (const f of files) {
    const r = f.models[model];
    if (!r?.description || r.error) continue;
    const d = `${r.description} ${r.purpose}`;
    if (d.includes("공개공지")) stats.gonggaegongji += 1;
    if (r.terms_used.length > 2) stats.terms_over_2 += 1;
    if (guessRe.test(d)) stats.guess_phrases += 1;
    if (r.category === "unknown") stats.unknown_category += 1;
  }
  return stats;
}

function printValidation(label: string, stats: ValidationStats): void {
  console.log(`  [${label}]`);
  console.log(`    공개공지 사용: ${stats.gonggaegongji}건`);
  console.log(`    용어 3개 이상: ${stats.terms_over_2}건`);
  console.log(`    추정/보인다 표현: ${stats.guess_phrases}건`);
  console.log(`    unknown 분류: ${stats.unknown_category}건`);
}

function renderModelBlock(
  label: string,
  r: ModelResult | undefined,
  cssClass: string
): string {
  if (!r) {
    return `<div class="block ${cssClass}"><h4>${esc(label)}</h4><p class="err">—</p></div>`;
  }
  if (r.error) {
    return `<div class="block ${cssClass}"><h4>${esc(label)}</h4><p class="err">${esc(r.error)}</p></div>`;
  }
  const terms =
    r.terms_used.length > 0
      ? `용어 ${r.terms_used.length}: ${esc(r.terms_used.join(", "))}`
      : "용어 0";
  const warn =
    r.terms_used.length > 2
      ? ' <span class="warn">⚠ 3개+</span>'
      : r.description.includes("공개공지")
        ? ' <span class="warn">⚠ 공개공지</span>'
        : "";
  return `<div class="block ${cssClass}">
  <h4>${esc(label)}${warn}</h4>
  <span class="cat">${esc(r.category)}</span>
  <p class="desc">${esc(r.description)}</p>
  <p class="purpose">${esc(r.purpose)}</p>
  <p class="terms">${esc(terms)}</p>
</div>`;
}

function writeHaikuV2Html(
  before: CompareDoc,
  after: CompareDoc,
  beforeStats: ValidationStats,
  afterStats: ValidationStats
): void {
  const cards = after.files
    .map((f) => {
      const beforeRow = before.files.find((b) => b.file_name === f.file_name);
      const beforeR = beforeRow?.models[HAIKU_MODEL];
      const afterR = f.models[HAIKU_MODEL];
      const src = encodeRelPath(f.file_name);
      return `<article class="card">
  <div class="hero">
    <img src="${src}" alt="${esc(f.file_name)}" loading="lazy"/>
    <div class="fname">${esc(f.file_name)}</div>
  </div>
  <div class="cols">
    ${renderModelBlock("before (v1 프롬프트)", beforeR, "before")}
    ${renderModelBlock("after (v2 용어·서술 규칙)", afterR, "after")}
  </div>
</article>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Haiku v1 vs v2 — ${after.file_count}장</title>
<style>
:root{color-scheme:light dark}
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#f0ede6;color:#1a1b1f;line-height:1.5}
header{padding:20px 24px;background:#1a1b1f;color:#fff}
header h1{margin:0 0 6px;font-size:20px}
header p{margin:0;opacity:.8;font-size:13px}
.wrap{max-width:1200px;margin:0 auto;padding:20px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;margin-bottom:24px;font-size:13px}
th,td{padding:10px 12px;border:1px solid #eceae4;text-align:center}
th{background:#f7f5f0}
.card{background:#fff;border-radius:14px;margin-bottom:28px;overflow:hidden;box-shadow:0 2px 8px #0002}
.hero{padding:16px;text-align:center;background:#111}
.hero img{max-width:100%;min-width:400px;min-height:280px;max-height:560px;object-fit:contain;display:block;margin:0 auto}
.fname{margin-top:12px;font-size:12px;color:#ccc;word-break:break-all}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0}
.block{padding:16px 18px;border-top:1px solid #eceae4}
.block.before{background:#fafafa;border-right:1px solid #eceae4}
.block.after{background:#f8fbff}
.block h4{margin:0 0 10px;font-size:13px;color:#444}
.cat{display:inline-block;background:#eef6ff;padding:2px 8px;border-radius:4px;font-size:11px;margin-bottom:8px}
.desc{margin:0 0 6px;font-size:14px}
.purpose{margin:0 0 6px;font-size:12px;color:#666}
.terms{margin:0;font-size:11px;color:#888}
.warn{color:#c2410c;font-size:11px}
.err{color:#9b1c1c}
@media(max-width:800px){.cols{grid-template-columns:1fr}.block.before{border-right:none}}
</style>
</head>
<body>
<header>
  <h1>claude-haiku-4-5 — 프롬프트 v1 vs v2</h1>
  <p>docs/image_test ${after.file_count}장 · 용어 조건·2개 상한·추측 금지</p>
</header>
<div class="wrap">
  <h2 style="font-size:15px">검증 지표</h2>
  <table>
    <thead><tr><th></th><th>공개공지</th><th>용어 3+</th><th>추정 표현</th><th>unknown</th></tr></thead>
    <tbody>
      <tr><td><strong>before v1</strong></td><td>${beforeStats.gonggaegongji}</td><td>${beforeStats.terms_over_2}</td><td>${beforeStats.guess_phrases}</td><td>${beforeStats.unknown_category}</td></tr>
      <tr><td><strong>after v2</strong></td><td>${afterStats.gonggaegongji}</td><td>${afterStats.terms_over_2}</td><td>${afterStats.guess_phrases}</td><td>${afterStats.unknown_category}</td></tr>
    </tbody>
  </table>
  ${cards}
</div>
</body></html>`;
  writeFileSync(join(IMAGE_DIR, "compare-haiku-v2.html"), html, "utf8");
}

function writeHtml(doc: CompareDoc): void {
  const models = [...COMPARE_MODEL_ORDER];
  const summaryRows = doc.model_runs
    .map(
      (r) => `<tr>
  <td><code>${esc(r.model_id)}</code></td>
  <td>${r.total_input_tokens.toLocaleString("ko-KR")}</td>
  <td>${r.total_output_tokens.toLocaleString("ko-KR")}</td>
  <td>${money(r.total_cost_usd)}</td>
  <td>${(r.total_elapsed_ms / 1000).toFixed(1)}s</td>
  <td>${r.terms_total} (평균 ${r.terms_avg.toFixed(1)})</td>
  <td>${money((r.per_image_cost_usd ?? 0) * doc.scale_total)}</td>
</tr>`
    )
    .join("\n");

  const cards = doc.files
    .map((f) => {
      const src = encodeRelPath(f.file_name);
      const modelBlocks = models
        .map((m) => {
          const r = f.models[m];
          if (!r) return `<div class="model"><h3>${esc(m)}</h3><p class="err">—</p></div>`;
          if (r.error) {
            return `<div class="model"><h3>${esc(m)}</h3><p class="err">${esc(r.error)}</p></div>`;
          }
          const terms =
            r.terms_used.length > 0
              ? `<div class="terms">용어 ${r.terms_used.length}: ${esc(r.terms_used.join(", "))}</div>`
              : `<div class="terms">용어 0</div>`;
          return `<div class="model">
  <h3>${esc(m)}</h3>
  <span class="cat">${esc(r.category)}</span>
  <p class="desc">${esc(r.description)}</p>
  <p class="purpose">${esc(r.purpose)}</p>
  ${terms}
</div>`;
        })
        .join("");
      return `<article class="card">
  <div class="hero">
    <img src="${src}" alt="${esc(f.file_name)}" loading="lazy"/>
    <div class="fname">${esc(f.file_name)}</div>
  </div>
  <div class="models">${modelBlocks}</div>
</article>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>비전 모델 3종 — image_test ${doc.file_count}장</title>
<style>
:root{color-scheme:light dark}
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#f0ede6;color:#1a1b1f;line-height:1.5}
header{padding:20px 24px;background:#1a1b1f;color:#fff}
header h1{margin:0 0 6px;font-size:20px}
header p{margin:0;opacity:.8;font-size:13px}
.wrap{max-width:1100px;margin:0 auto;padding:20px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;margin-bottom:24px;font-size:13px;box-shadow:0 1px 4px #0001}
th,td{padding:10px 12px;border-bottom:1px solid #eceae4;text-align:left}
th{background:#f7f5f0;font-size:11px}
.card{background:#fff;border-radius:14px;margin-bottom:28px;overflow:hidden;box-shadow:0 2px 8px #0002}
.hero{padding:16px;text-align:center;background:#111}
.hero img{max-width:100%;min-width:400px;min-height:280px;max-height:560px;object-fit:contain;display:block;margin:0 auto}
.fname{margin-top:12px;font-size:12px;color:#ccc;word-break:break-all}
.models{padding:16px 20px;display:flex;flex-direction:column;gap:16px}
.model{border-left:4px solid #c5daf5;padding-left:14px}
.model h3{margin:0 0 8px;font-size:13px;color:#444}
.cat{display:inline-block;background:#eef6ff;padding:2px 8px;border-radius:4px;font-size:11px;margin-bottom:8px}
.desc{margin:0 0 6px;font-size:14px}
.purpose{margin:0 0 6px;font-size:12px;color:#666}
.terms{font-size:11px;color:#888}
.err{color:#9b1c1c;font-size:13px}
</style>
</head>
<body>
<header>
  <h1>비전 모델 3종 비교 — ${doc.file_count}장</h1>
  <p>docs/image_test · max_tokens=${doc.vision_max_tokens} · DB 미기록</p>
</header>
<div class="wrap">
  <h2 style="font-size:15px">모델별 집계</h2>
  <table>
    <thead><tr>
      <th>모델</th><th>입력</th><th>출력</th><th>비용</th><th>시간</th><th>용어</th><th>${doc.scale_total.toLocaleString("ko-KR")}장 예상</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  ${cards}
</div>
</body></html>`;
  writeFileSync(join(IMAGE_DIR, "compare.html"), html, "utf8");
}

function printReport(doc: CompareDoc): void {
  console.log("\n=== image_test vision compare ===\n");
  console.log("1. 모델별 토큰·비용·소요 시간");
  for (const r of doc.model_runs) {
    console.log(
      `  ${r.model_id}: in=${r.total_input_tokens.toLocaleString("ko-KR")} out=${r.total_output_tokens.toLocaleString("ko-KR")} cost=${money(r.total_cost_usd)} time=${(r.total_elapsed_ms / 1000).toFixed(1)}s`
    );
  }
  console.log(`\n2. ${doc.scale_total.toLocaleString("ko-KR")}장 확대 예상 비용`);
  for (const r of doc.model_runs) {
    if (r.per_image_cost_usd != null) {
      console.log(
        `  ${r.model_id}: ${money(r.per_image_cost_usd * doc.scale_total)} (장당 ${money(r.per_image_cost_usd)})`
      );
    }
  }
  console.log("\n3. 아폴론 용어 사용 (합·평균)");
  for (const r of doc.model_runs) {
    console.log(
      `  ${r.model_id}: 합 ${r.terms_total} · 평균 ${r.terms_avg.toFixed(1)}/장`
    );
  }
  console.log("");
}

async function runSingleModel(
  model: string,
  images: string[],
  glossary: Awaited<ReturnType<typeof loadVisualGlossary>>
): Promise<CompareDoc> {
  const doc: CompareDoc = {
    generated_at: new Date().toISOString(),
    image_dir: "docs/image_test",
    file_count: images.length,
    scale_total: SCALE_TOTAL,
    vision_max_tokens: VISION_MAX_TOKENS,
    prompt_version: "v2",
    model_runs: [],
    files: []
  };

  let inTok = 0;
  let outTok = 0;
  let ms = 0;
  let cost = 0;
  let terms = 0;
  let ok = 0;

  for (const fullPath of images) {
    const fileName = basename(fullPath);
    const row: FileRow = {
      file_name: fileName,
      relative_path: fileName,
      models: {}
    };

    const jpegB64 = await resizeForVision(fullPath);
    if (!jpegB64) {
      row.models[model] = {
        description: "",
        category: "unknown",
        purpose: "",
        terms_used: [],
        input_tokens: 0,
        output_tokens: 0,
        elapsed_ms: 0,
        cost_usd: null,
        error: "image_unreadable"
      };
      doc.files.push(row);
      console.error(`skip unreadable: ${fileName}`);
      continue;
    }

    const prompt = buildLocalImageTestVisionPrompt(glossary, fileName);
    process.stdout.write(`${fileName} · ${model} … `);
    const t0 = Date.now();
    try {
      const vision = await analyzeMediaImageVision(jpegB64, prompt, {
        model,
        maxTokens: VISION_MAX_TOKENS
      });
      const elapsed = Date.now() - t0;
      const text = [vision.result.description, vision.result.purpose]
        .filter(Boolean)
        .join("\n");
      const termsUsed = countGlossaryTermsInText(text, glossary);
      const c = visionCostUsd(
        model,
        vision.usage.inputTokens,
        vision.usage.outputTokens
      );
      row.models[model] = {
        description: vision.result.description,
        category: vision.result.category,
        purpose: vision.result.purpose,
        terms_used: termsUsed,
        input_tokens: vision.usage.inputTokens,
        output_tokens: vision.usage.outputTokens,
        elapsed_ms: elapsed,
        cost_usd: c
      };
      inTok += vision.usage.inputTokens;
      outTok += vision.usage.outputTokens;
      ms += elapsed;
      cost += c ?? 0;
      terms += termsUsed.length;
      ok += 1;
      console.log(`ok (${elapsed}ms, terms=${termsUsed.length}, ${vision.result.category})`);
    } catch (e) {
      const elapsed = Date.now() - t0;
      const errMsg = e instanceof Error ? e.message : String(e);
      row.models[model] = {
        description: "",
        category: "unknown",
        purpose: "",
        terms_used: [],
        input_tokens: 0,
        output_tokens: 0,
        elapsed_ms: elapsed,
        cost_usd: null,
        error: errMsg.slice(0, 500)
      };
      console.error(`fail — ${errMsg.slice(0, 400)}`);
    }
    doc.files.push(row);
  }

  doc.model_runs.push({
    model_id: model,
    file_count: ok,
    total_input_tokens: inTok,
    total_output_tokens: outTok,
    total_elapsed_ms: ms,
    total_cost_usd: ok > 0 ? cost : null,
    per_image_cost_usd: ok > 0 ? cost / ok : null,
    terms_total: terms,
    terms_avg: ok > 0 ? terms / ok : 0
  });

  return doc;
}

async function main(): Promise<void> {
  const { model: modelArg } = parseArgs(process.argv.slice(2));
  const singleModel = modelArg;
  const modelsToRun = singleModel ? [singleModel] : [...COMPARE_MODEL_ORDER];

  if (singleModel) {
    const provider = resolveMediaVisionProvider(singleModel);
    if (provider === "anthropic" && !lunaAnthropicApiKey()) {
      console.error("hubtrendchat_claude / ANTHROPIC_API_KEY missing");
      process.exit(1);
    }
    if (provider === "openai" && !lunaOpenAiApiKey()) {
      console.error("LUNA_OPENAI_API_KEY missing");
      process.exit(1);
    }
  } else {
    if (!lunaOpenAiApiKey() || !lunaAnthropicApiKey()) {
      console.error("OpenAI + Anthropic keys required for 3-model compare");
      process.exit(1);
    }
  }

  const images = collectImages(IMAGE_DIR);
  if (images.length === 0) {
    console.error(`no images in ${IMAGE_DIR}`);
    process.exit(1);
  }
  console.log(`images: ${images.length} · models: ${modelsToRun.join(", ")}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("SUPABASE credentials missing (glossary load)");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const glossary = await loadVisualGlossary(admin);
  console.log(`glossary: ${glossary.length} terms · max_tokens=${VISION_MAX_TOKENS}`);

  if (singleModel === HAIKU_MODEL) {
    const before = loadCompareDoc("compare.json");
    if (!before) {
      console.error("compare.json 없음 — 먼저 3모델 compare를 실행하세요");
      process.exit(1);
    }

    const after = await runSingleModel(singleModel, images, glossary);
    writeFileSync(
      join(IMAGE_DIR, "compare-haiku-v2.json"),
      JSON.stringify(after, null, 2),
      "utf8"
    );

    const beforeStats = validateHaiku(before.files, HAIKU_MODEL);
    const afterStats = validateHaiku(after.files, HAIKU_MODEL);
    writeHaikuV2Html(before, after, beforeStats, afterStats);

    console.log("\n=== haiku v1 vs v2 검증 ===");
    printValidation("before v1", beforeStats);
    printValidation("after v2", afterStats);
    printReport(after);
    console.log(`HTML: docs/image_test/compare-haiku-v2.html`);
    return;
  }

  if (singleModel) {
    const doc = await runSingleModel(singleModel, images, glossary);
    printReport(doc);
    return;
  }

  // 3-model full compare (unchanged flow)
  const doc: CompareDoc = {
    generated_at: new Date().toISOString(),
    image_dir: "docs/image_test",
    file_count: images.length,
    scale_total: SCALE_TOTAL,
    vision_max_tokens: VISION_MAX_TOKENS,
    model_runs: [],
    files: []
  };

  const runStats: Record<
    string,
    { in: number; out: number; ms: number; cost: number; terms: number; ok: number }
  > = {};
  for (const m of COMPARE_MODEL_ORDER) {
    runStats[m] = { in: 0, out: 0, ms: 0, cost: 0, terms: 0, ok: 0 };
  }

  for (const fullPath of images) {
    const fileName = basename(fullPath);
    const row: FileRow = {
      file_name: fileName,
      relative_path: fileName,
      models: {}
    };

    const jpegB64 = await resizeForVision(fullPath);
    if (!jpegB64) {
      for (const m of COMPARE_MODEL_ORDER) {
        row.models[m] = {
          description: "",
          category: "unknown",
          purpose: "",
          terms_used: [],
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: 0,
          cost_usd: null,
          error: "image_unreadable"
        };
      }
      doc.files.push(row);
      continue;
    }

    const prompt = buildLocalImageTestVisionPrompt(glossary, fileName);

    for (const model of COMPARE_MODEL_ORDER) {
      process.stdout.write(`${fileName} · ${model} … `);
      const t0 = Date.now();
      try {
        const vision = await analyzeMediaImageVision(jpegB64, prompt, {
          model,
          maxTokens: VISION_MAX_TOKENS
        });
        const elapsed = Date.now() - t0;
        const text = [vision.result.description, vision.result.purpose]
          .filter(Boolean)
          .join("\n");
        const termsUsed = countGlossaryTermsInText(text, glossary);
        const c = visionCostUsd(
          model,
          vision.usage.inputTokens,
          vision.usage.outputTokens
        );
        row.models[model] = {
          description: vision.result.description,
          category: vision.result.category,
          purpose: vision.result.purpose,
          terms_used: termsUsed,
          input_tokens: vision.usage.inputTokens,
          output_tokens: vision.usage.outputTokens,
          elapsed_ms: elapsed,
          cost_usd: c
        };
        const st = runStats[model]!;
        st.in += vision.usage.inputTokens;
        st.out += vision.usage.outputTokens;
        st.ms += elapsed;
        st.cost += c ?? 0;
        st.terms += termsUsed.length;
        st.ok += 1;
        console.log(`ok (${elapsed}ms, terms=${termsUsed.length})`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        row.models[model] = {
          description: "",
          category: "unknown",
          purpose: "",
          terms_used: [],
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: Date.now() - t0,
          cost_usd: null,
          error: errMsg.slice(0, 500)
        };
        console.error(`fail — ${errMsg.slice(0, 300)}`);
      }
    }
    doc.files.push(row);
  }

  for (const model of COMPARE_MODEL_ORDER) {
    const st = runStats[model]!;
    doc.model_runs.push({
      model_id: model,
      file_count: st.ok,
      total_input_tokens: st.in,
      total_output_tokens: st.out,
      total_elapsed_ms: st.ms,
      total_cost_usd: st.ok > 0 ? st.cost : null,
      per_image_cost_usd: st.ok > 0 ? st.cost / st.ok : null,
      terms_total: st.terms,
      terms_avg: st.ok > 0 ? st.terms / st.ok : 0
    });
  }

  writeFileSync(
    join(IMAGE_DIR, "compare.json"),
    JSON.stringify(doc, null, 2),
    "utf8"
  );
  writeHtml(doc);
  printReport(doc);
  console.log(`JSON: docs/image_test/compare.json`);
  console.log(`HTML: docs/image_test/compare.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
