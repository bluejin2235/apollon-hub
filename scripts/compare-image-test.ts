/**
 * docs/image_test 로컬 이미지 × 비전 모델 3종 비교
 *
 *   npx tsx scripts/compare-image-test.ts
 *
 * DB·Storage 미사용. 결과: docs/image_test/compare.json · compare.html
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { readdirSync, writeFileSync } from "node:fs";
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
  buildLocalImageTestVisionPrompt
} from "@/lib/luna/media-vision";
import {
  lunaAnthropicApiKey,
  lunaOpenAiApiKey
} from "@/lib/luna/media-vision-api";
import { loadVisualGlossary } from "@/lib/luna/media-vision-prompt";

const IMAGE_DIR = join(process.cwd(), "docs", "image_test");
const SCALE_TOTAL = 2230;
const VISION_MAX_TOKENS = 1024;

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
  model_runs: ModelRun[];
  files: FileRow[];
};

function collectImages(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (name === "compare.json" || name === "compare.html") return false;
      const ext = extname(name).toLowerCase();
      return IMAGE_EXTS.has(ext);
    })
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => join(dir, name));
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

async function main(): Promise<void> {
  if (!lunaOpenAiApiKey()) {
    console.error("LUNA_OPENAI_API_KEY missing");
    process.exit(1);
  }
  if (!lunaAnthropicApiKey()) {
    console.error("hubtrendchat_claude / ANTHROPIC_API_KEY missing");
    process.exit(1);
  }

  const images = collectImages(IMAGE_DIR);
  if (images.length === 0) {
    console.error(`no images in ${IMAGE_DIR}`);
    process.exit(1);
  }
  console.log(`images: ${images.length} in ${IMAGE_DIR}`);

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
    {
      in: number;
      out: number;
      ms: number;
      cost: number;
      terms: number;
      ok: number;
    }
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
      console.error(`skip unreadable: ${fileName}`);
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
        const ms = Date.now() - t0;
        const text = [vision.result.description, vision.result.purpose]
          .filter(Boolean)
          .join("\n");
        const terms = countGlossaryTermsInText(text, glossary);
        const cost = visionCostUsd(
          model,
          vision.usage.inputTokens,
          vision.usage.outputTokens
        );
        row.models[model] = {
          description: vision.result.description,
          category: vision.result.category,
          purpose: vision.result.purpose,
          terms_used: terms,
          input_tokens: vision.usage.inputTokens,
          output_tokens: vision.usage.outputTokens,
          elapsed_ms: ms,
          cost_usd: cost
        };
        const st = runStats[model]!;
        st.in += vision.usage.inputTokens;
        st.out += vision.usage.outputTokens;
        st.ms += ms;
        st.cost += cost ?? 0;
        st.terms += terms.length;
        st.ok += 1;
        console.log(`ok (${ms}ms, terms=${terms.length})`);
      } catch (e) {
        const ms = Date.now() - t0;
        const errMsg = e instanceof Error ? e.message : String(e);
        row.models[model] = {
          description: "",
          category: "unknown",
          purpose: "",
          terms_used: [],
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: ms,
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

  doc.generated_at = new Date().toISOString();
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
