/**
 * docs/image_test 19장 × 비전 입력 해상도 640 vs 800 (claude-haiku-4-5)
 *
 *   npx tsx scripts/compare-vision-resolution.ts
 *
 * DB·색인 코드 미수정. 결과: docs/image_test/compare-resolution-640-800.json · .html
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import {
  countGlossaryTermsInText,
  visionCostUsd
} from "@/lib/luna/media-model-compare";
import {
  analyzeMediaImageVision,
  buildLocalImageTestVisionPrompt
} from "@/lib/luna/media-vision";
import { lunaAnthropicApiKey } from "@/lib/luna/media-vision-api";
import { loadVisualGlossary } from "@/lib/luna/media-vision-prompt";

const IMAGE_DIR = join(process.cwd(), "docs", "image_test");
const OUT_JSON = "compare-resolution-640-800.json";
const OUT_HTML = "compare-resolution-640-800.html";
const RESOLUTIONS = [640, 800] as const;
const MODEL = "claude-haiku-4-5";
const VISION_MAX_TOKENS = 1024;
const SCALE_SMALL = 2230;
const SCALE_LARGE = 77065;

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
  "compare-haiku-v2.html",
  "compare-haiku-v3.json",
  "compare-haiku-v3.html",
  OUT_JSON,
  OUT_HTML
]);

/** 글자·로고·간판 우선 확인 대상 */
const PRIORITY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "F1 텔레메트리", re: /^F1 /i },
  { label: "삼성전자판매 사업자등록증", re: /사업자등록증/ },
  { label: "나이키 팝업", re: /나이키|nike/i },
  { label: "커피 브랜드 배너", re: /커피|coffee|카페/i },
  { label: "노트르담", re: /노트르|notre|dame/i }
];

type ResResult = {
  description: string;
  category: string;
  purpose: string;
  terms_used: string[];
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
  cost_usd: number | null;
  jpeg_bytes: number;
  error?: string;
};

type FileRow = {
  file_name: string;
  relative_path: string;
  priority_label: string | null;
  resolutions: Record<string, ResResult>;
};

type ResRun = {
  max_px: number;
  file_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_elapsed_ms: number;
  total_cost_usd: number | null;
  per_image_cost_usd: number | null;
  avg_jpeg_bytes: number;
};

type CompareDoc = {
  generated_at: string;
  image_dir: string;
  model: string;
  file_count: number;
  vision_max_tokens: number;
  resolutions: number[];
  scale_totals: { small: number; large: number };
  resolution_runs: ResRun[];
  files: FileRow[];
};

function collectImages(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (SKIP_NAMES.has(name)) return false;
      return IMAGE_EXTS.has(extname(name).toLowerCase());
    })
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => join(dir, name));
}

function priorityLabel(fileName: string): string | null {
  for (const p of PRIORITY_PATTERNS) {
    if (p.re.test(fileName)) return p.label;
  }
  return null;
}

async function resizeForVisionPx(
  filePath: string,
  maxPx: number
): Promise<{ b64: string; bytes: number } | null> {
  try {
    const ext = extname(filePath).toLowerCase();
    const density = ext === ".psd" || ext === ".ai" ? 72 : undefined;
    const buf = await sharp(filePath, { failOn: "none", density })
      .rotate()
      .resize({
        width: maxPx,
        height: maxPx,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { b64: buf.toString("base64"), bytes: buf.length };
  } catch {
    return null;
  }
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function descriptionsDiffer(a: ResResult, b: ResResult): boolean {
  if (a.error || b.error) return false;
  return normalizeText(a.description) !== normalizeText(b.description);
}

function categoriesDiffer(a: ResResult, b: ResResult): boolean {
  if (a.error || b.error) return false;
  return a.category !== b.category;
}

/** 800에서만 읽힌 것으로 보이는 토큰 — 단순 휴리스틱 */
function onlyIn800(a640: ResResult, a800: ResResult): string[] {
  if (a640.error || a800.error) return [];
  const d640 = normalizeText(`${a640.description} ${a640.purpose}`).toLowerCase();
  const d800 = normalizeText(`${a800.description} ${a800.purpose}`);
  const hits: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/[\u4e00-\u9fff]{2,}/g, "한자"],
    [/\b\d{2,3}\s*(?:km|kph|mph|rpm|%)/gi, "수치"],
    [/[A-Z]{2,}(?:\s+[A-Z]{2,})+/g, "로고/약어"],
    [/(?:주식회사|대표|등록번호|사업자)/g, "행정 텍스트"],
    [/(?:나이키|NIKE|스타벅스|STARBUCKS|삼성|SAMSUNG)/gi, "브랜드"],
    [/(?:노트르|Notre|Dame|성당|고딕)/gi, "건축명"]
  ];
  for (const [re, label] of patterns) {
    const m800 = d800.match(re) ?? [];
    for (const m of m800) {
      const needle = m.toLowerCase();
      if (needle.length >= 2 && !d640.includes(needle)) {
        hits.push(`${label}: ${m.trim()}`);
      }
    }
  }
  return [...new Set(hits)].slice(0, 8);
}

/** 800이 더 장황·사소한 디테일 */
function extra800Noise(a640: ResResult, a800: ResResult): boolean {
  if (a640.error || a800.error) return false;
  const len640 = normalizeText(a640.description).length;
  const len800 = normalizeText(a800.description).length;
  if (len800 <= len640 + 30) return false;
  const extra = normalizeText(a800.description).slice(len640);
  return /(?:미세|작은|세부|잔|가장자리|픽셀|노이즈|grain)/i.test(extra);
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

function writeHtml(doc: CompareDoc): void {
  const cards = doc.files
    .map((f) => {
      const r640 = f.resolutions["640"];
      const r800 = f.resolutions["800"];
      const pri = f.priority_label
        ? `<span class="pri">${esc(f.priority_label)}</span>`
        : "";
      const block = (label: string, r: ResResult | undefined, cls: string) => {
        if (!r) return `<div class="block ${cls}"><h4>${label}</h4><p>—</p></div>`;
        if (r.error) {
          return `<div class="block ${cls}"><h4>${label}</h4><p class="err">${esc(r.error)}</p></div>`;
        }
        return `<div class="block ${cls}">
  <h4>${label} · ${r.jpeg_bytes.toLocaleString("ko-KR")}B · in=${r.input_tokens} out=${r.output_tokens}</h4>
  <span class="cat">${esc(r.category)}</span>
  <p class="desc">${esc(r.description)}</p>
  <p class="purpose">${esc(r.purpose)}</p>
</div>`;
      };
      return `<article class="card">
  <div class="hero"><img src="${encodeURIComponent(f.file_name)}" alt=""/><div class="fname">${esc(f.file_name)}${pri}</div></div>
  <div class="cols">${block("640px", r640, "r640")}${block("800px", r800, "r800")}</div>
</article>`;
    })
    .join("\n");

  const summary = doc.resolution_runs
    .map(
      (r) => `<tr>
  <td>${r.max_px}px</td>
  <td>${r.total_input_tokens.toLocaleString("ko-KR")}</td>
  <td>${r.total_output_tokens.toLocaleString("ko-KR")}</td>
  <td>${money(r.total_cost_usd)}</td>
  <td>${(r.total_elapsed_ms / 1000).toFixed(1)}s</td>
  <td>${Math.round(r.avg_jpeg_bytes).toLocaleString("ko-KR")}B</td>
  <td>${money((r.per_image_cost_usd ?? 0) * doc.scale_totals.small)}</td>
  <td>${money((r.per_image_cost_usd ?? 0) * doc.scale_totals.large)}</td>
</tr>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>640 vs 800 vision — ${doc.file_count}장</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f0ede6}
header{padding:20px;background:#1a1b1f;color:#fff}
.wrap{max-width:1200px;margin:0 auto;padding:20px}
table{width:100%;border-collapse:collapse;background:#fff;margin-bottom:24px;font-size:13px}
th,td{padding:8px 10px;border:1px solid #ddd;text-align:center}
.card{background:#fff;border-radius:12px;margin-bottom:24px;overflow:hidden}
.hero{padding:12px;text-align:center;background:#111}
.hero img{max-height:360px;max-width:100%}
.fname{color:#ccc;font-size:11px;margin-top:8px;word-break:break-all}
.pri{display:block;color:#fbbf24;margin-top:4px}
.cols{display:grid;grid-template-columns:1fr 1fr}
.block{padding:14px;border-top:1px solid #eee}
.r640{background:#fafafa;border-right:1px solid #eee}
.r800{background:#f8fbff}
.cat{font-size:11px;background:#eef6ff;padding:2px 6px;border-radius:4px}
.desc{font-size:14px;margin:8px 0 4px}
.purpose{font-size:12px;color:#666;margin:0}
.err{color:#b91c1c}
</style></head>
<body><header><h1>640 vs 800 — ${esc(doc.model)} · ${doc.file_count}장</h1></header>
<div class="wrap">
<table><thead><tr><th>입력</th><th>in</th><th>out</th><th>비용</th><th>시간</th><th>JPEG</th><th>${doc.scale_totals.small.toLocaleString("ko-KR")}장</th><th>${doc.scale_totals.large.toLocaleString("ko-KR")}장</th></tr></thead>
<tbody>${summary}</tbody></table>
${cards}
</div></body></html>`;
  writeFileSync(join(IMAGE_DIR, OUT_HTML), html, "utf8");
}

function printReport(doc: CompareDoc): void {
  const r640 = doc.resolution_runs.find((r) => r.max_px === 640)!;
  const r800 = doc.resolution_runs.find((r) => r.max_px === 800)!;

  console.log("\n=== 640 vs 800 vision resolution compare ===\n");
  console.log("1. 집계 (19장)");
  for (const r of doc.resolution_runs) {
    console.log(
      `  ${r.max_px}px: in=${r.total_input_tokens.toLocaleString("ko-KR")} out=${r.total_output_tokens.toLocaleString("ko-KR")} cost=${money(r.total_cost_usd)} time=${(r.total_elapsed_ms / 1000).toFixed(1)}s avg_jpeg=${Math.round(r.avg_jpeg_bytes).toLocaleString("ko-KR")}B`
    );
  }

  console.log("\n2. 확대 비용");
  for (const scale of [
    { label: "2,230", n: SCALE_SMALL },
    { label: "77,065", n: SCALE_LARGE }
  ]) {
    console.log(`  [${scale.label}장]`);
    console.log(
      `    640px: ${money((r640.per_image_cost_usd ?? 0) * scale.n)} (장당 ${money(r640.per_image_cost_usd)})`
    );
    console.log(
      `    800px: ${money((r800.per_image_cost_usd ?? 0) * scale.n)} (장당 ${money(r800.per_image_cost_usd)})`
    );
    const delta =
      (r800.per_image_cost_usd ?? 0) * scale.n -
      (r640.per_image_cost_usd ?? 0) * scale.n;
    console.log(`    차이(800−640): +${money(delta)}`);
  }

  const diffFiles = doc.files
    .filter((f) => {
      const a = f.resolutions["640"];
      const b = f.resolutions["800"];
      return a && b && descriptionsDiffer(a, b);
    })
    .sort((a, b) => {
      const pa = a.priority_label ? 0 : 1;
      const pb = b.priority_label ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const da = normalizeText(a.resolutions["800"]!.description).length;
      const db = normalizeText(b.resolutions["640"]!.description).length;
      return Math.abs(da - db) - Math.abs(db - da);
    });

  console.log(`\n3. 설명 차이 ${diffFiles.length}/${doc.file_count}장`);
  const top5 = diffFiles.slice(0, 5);
  for (const f of top5) {
    const a640 = f.resolutions["640"]!;
    const a800 = f.resolutions["800"]!;
    console.log(`\n  --- ${f.file_name}${f.priority_label ? ` [${f.priority_label}]` : ""} ---`);
    console.log(`  [640] (${a640.category}) ${a640.description}`);
    console.log(`  [800] (${a800.category}) ${a800.description}`);
  }

  const catDiffs = doc.files.filter((f) =>
    categoriesDiffer(f.resolutions["640"]!, f.resolutions["800"]!)
  );
  console.log(`\n6. 분류 변경: ${catDiffs.length}건`);
  for (const f of catDiffs) {
    console.log(
      `  ${f.file_name}: ${f.resolutions["640"]!.category} → ${f.resolutions["800"]!.category}`
    );
  }

  const only800 = doc.files
    .map((f) => ({
      file: f.file_name,
      label: f.priority_label,
      hits: onlyIn800(f.resolutions["640"]!, f.resolutions["800"]!)
    }))
    .filter((x) => x.hits.length > 0);
  console.log(`\n4. 800에서만 읽힌 정보(휴리스틱): ${only800.length}건`);
  for (const x of only800.slice(0, 8)) {
    console.log(`  ${x.file}: ${x.hits.join("; ")}`);
  }

  const noise = doc.files.filter((f) =>
    extra800Noise(f.resolutions["640"]!, f.resolutions["800"]!)
  );
  console.log(`\n5. 800이 더 장황(사소 디테일): ${noise.length}건`);
  for (const f of noise.slice(0, 5)) {
    console.log(`  ${f.file}`);
  }
}

async function main(): Promise<void> {
  if (!lunaAnthropicApiKey()) {
    console.error("hubtrendchat_claude / ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  const images = collectImages(IMAGE_DIR);
  if (images.length === 0) {
    console.error(`no images in ${IMAGE_DIR}`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("SUPABASE credentials missing (glossary)");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const glossary = await loadVisualGlossary(admin);

  console.log(
    `images: ${images.length} · model: ${MODEL} · resolutions: ${RESOLUTIONS.join(", ")}px`
  );

  const doc: CompareDoc = {
    generated_at: new Date().toISOString(),
    image_dir: "docs/image_test",
    model: MODEL,
    file_count: images.length,
    vision_max_tokens: VISION_MAX_TOKENS,
    resolutions: [...RESOLUTIONS],
    scale_totals: { small: SCALE_SMALL, large: SCALE_LARGE },
    resolution_runs: RESOLUTIONS.map((max_px) => ({
      max_px,
      file_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_elapsed_ms: 0,
      total_cost_usd: 0,
      per_image_cost_usd: null,
      avg_jpeg_bytes: 0
    })),
    files: []
  };

  const runByPx = new Map(doc.resolution_runs.map((r) => [r.max_px, r]));
  const jpegSum = new Map<number, number>();

  for (const fullPath of images) {
    const fileName = basename(fullPath);
    const row: FileRow = {
      file_name: fileName,
      relative_path: fileName,
      priority_label: priorityLabel(fileName),
      resolutions: {}
    };

    const prompt = buildLocalImageTestVisionPrompt(glossary, fileName);

    for (const maxPx of RESOLUTIONS) {
      const resized = await resizeForVisionPx(fullPath, maxPx);
      if (!resized) {
        row.resolutions[String(maxPx)] = {
          description: "",
          category: "unknown",
          purpose: "",
          terms_used: [],
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: 0,
          cost_usd: null,
          jpeg_bytes: 0,
          error: "image_unreadable"
        };
        console.error(`skip ${fileName} @ ${maxPx}px`);
        continue;
      }

      process.stdout.write(`${fileName} · ${maxPx}px … `);
      const t0 = Date.now();
      try {
        const vision = await analyzeMediaImageVision(resized.b64, prompt, {
          model: MODEL,
          maxTokens: VISION_MAX_TOKENS
        });
        const elapsed = Date.now() - t0;
        const text = [vision.result.description, vision.result.purpose]
          .filter(Boolean)
          .join("\n");
        const termsUsed = countGlossaryTermsInText(text, glossary);
        const cost = visionCostUsd(
          MODEL,
          vision.usage.inputTokens,
          vision.usage.outputTokens
        );
        row.resolutions[String(maxPx)] = {
          description: vision.result.description,
          category: vision.result.category,
          purpose: vision.result.purpose,
          terms_used: termsUsed,
          input_tokens: vision.usage.inputTokens,
          output_tokens: vision.usage.outputTokens,
          elapsed_ms: elapsed,
          cost_usd: cost,
          jpeg_bytes: resized.bytes
        };
        const run = runByPx.get(maxPx)!;
        run.total_input_tokens += vision.usage.inputTokens;
        run.total_output_tokens += vision.usage.outputTokens;
        run.total_elapsed_ms += elapsed;
        run.total_cost_usd = (run.total_cost_usd ?? 0) + (cost ?? 0);
        run.file_count += 1;
        jpegSum.set(maxPx, (jpegSum.get(maxPx) ?? 0) + resized.bytes);
        console.log(
          `ok in=${vision.usage.inputTokens} out=${vision.usage.outputTokens} ${vision.result.category} (${elapsed}ms)`
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        row.resolutions[String(maxPx)] = {
          description: "",
          category: "unknown",
          purpose: "",
          terms_used: [],
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: Date.now() - t0,
          cost_usd: null,
          jpeg_bytes: resized.bytes,
          error: errMsg.slice(0, 500)
        };
        console.error(`fail — ${errMsg.slice(0, 200)}`);
      }
    }
    doc.files.push(row);
  }

  for (const run of doc.resolution_runs) {
    if (run.file_count > 0) {
      run.per_image_cost_usd = (run.total_cost_usd ?? 0) / run.file_count;
      run.avg_jpeg_bytes = (jpegSum.get(run.max_px) ?? 0) / run.file_count;
    }
  }

  writeFileSync(
    join(IMAGE_DIR, OUT_JSON),
    JSON.stringify(doc, null, 2),
    "utf8"
  );
  writeHtml(doc);
  printReport(doc);
  console.log(`\nJSON: docs/image_test/${OUT_JSON}`);
  console.log(`HTML: docs/image_test/${OUT_HTML}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
