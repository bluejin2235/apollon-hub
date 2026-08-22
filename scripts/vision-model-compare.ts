/**
 * 대표 이미지 1장 × 비전 모델 전수 비교
 *
 * 회사 PC (T: 보임)에서:
 *   npx tsx scripts/vision-model-compare.ts
 *
 * 옵션:
 *   --image="T:\\...\\Img(1).jpg"   대표 이미지 지정
 *   --skip-missing-keys             (기본) 키 없으면 skip 행만
 *
 * 결과: tmp/vision-model-compare.json · tmp/vision-model-compare.html
 * DB·설정 화면 미수정.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyFolderCategory,
  parseMediaPath
} from "../lib/luna/media-path-parse";
import {
  buildMediaVisionPrompt,
  formatGlossaryBlock,
  loadNotionProjectContexts,
  loadVisualGlossary,
  parseMediaVisionJson
} from "../lib/luna/media-vision-prompt";
import {
  resolveOfficialPrice,
  type OfficialModelPrice
} from "../lib/luna/model-pricing";

const DEFAULT_IMAGE =
  "T:\\02 Project\\2025\\250324 삼성디스플레이 신사옥 로비 미디어콘텐츠\\88 홍보마케팅\\04 인스타그램 업로드용\\보류\\Img(1).jpg";

type Provider = "openai" | "anthropic" | "google";

type CompareModel = {
  provider: Provider;
  model_id: string;
  model_label: string;
};

/** LUNA 모델 목록과 맞춘 비전 비교 대상 */
const COMPARE_MODELS: CompareModel[] = [
  { provider: "openai", model_id: "gpt-4o-mini", model_label: "GPT-4o mini" },
  { provider: "openai", model_id: "gpt-4o", model_label: "GPT-4o" },
  {
    provider: "openai",
    model_id: "gpt-5.6-luna",
    model_label: "GPT-5.6 Luna"
  },
  { provider: "openai", model_id: "gpt-5-mini", model_label: "GPT-5 mini" },
  {
    provider: "anthropic",
    model_id: "claude-haiku-4-5",
    model_label: "Claude Haiku 4.5"
  },
  {
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    model_label: "Claude Sonnet 4.6"
  },
  {
    provider: "anthropic",
    model_id: "claude-opus-4-6",
    model_label: "Claude Opus 4.6"
  },
  {
    provider: "google",
    model_id: "gemini-2.5-flash",
    model_label: "Gemini 2.5 Flash"
  },
  {
    provider: "google",
    model_id: "gemini-2.5-pro",
    model_label: "Gemini 2.5 Pro"
  }
];

type RowStatus = "ok" | "no_key" | "error";

type CompareRow = {
  provider: Provider;
  model_id: string;
  model_label: string;
  status: RowStatus;
  description: string | null;
  purpose: string | null;
  author: string | null;
  ai_category: string | null;
  terms_used: string[];
  term_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_1: number | null;
  cost_usd_10k: number | null;
  cost_usd_50k: number | null;
  cost_usd_150k: number | null;
  elapsed_ms: number | null;
  eta_50k_hours: number | null;
  price_in_per_m: number | null;
  price_out_per_m: number | null;
  error: string | null;
};

function openaiKey(): string | null {
  return (
    process.env.LUNA_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null
  );
}
function anthropicKey(): string | null {
  return (
    process.env.hubtrendchat_claude?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    null
  );
}
function googleKey(): string | null {
  return (
    process.env.LUNA_GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    null
  );
}

function keyFor(p: Provider): string | null {
  if (p === "openai") return openaiKey();
  if (p === "anthropic") return anthropicKey();
  return googleKey();
}

function estimateUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const price: OfficialModelPrice | null = resolveOfficialPrice(modelId);
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}

function parseArgs(argv: string[]) {
  let image = DEFAULT_IMAGE;
  for (const a of argv) {
    if (a.startsWith("--image=")) image = a.slice(8);
  }
  return { image };
}

async function loadSharp(): Promise<typeof import("sharp") | null> {
  try {
    return (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("sharp");
    } catch {
      return null;
    }
  }
}

async function visionOpenAI(
  model: string,
  prompt: string,
  jpegBase64: string
): Promise<{
  text: string;
  input_tokens: number;
  output_tokens: number;
}> {
  const key = openaiKey();
  if (!key) throw new Error("키 없음");
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${jpegBase64}`,
              detail: "low"
            }
          }
        ]
      }
    ]
  };
  if (/^gpt-5|^o[1-4]|codex/i.test(model)) {
    body.max_completion_tokens = 700;
  } else {
    body.max_tokens = 700;
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 280)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0
  };
}

async function visionAnthropic(
  model: string,
  prompt: string,
  jpegBase64: string
): Promise<{
  text: string;
  input_tokens: number;
  output_tokens: number;
}> {
  const key = anthropicKey();
  if (!key) throw new Error("키 없음");
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: jpegBase64
            }
          },
          { type: "text", text: prompt }
        ]
      }
    ]
  });
  const text =
    res.content.find((b) => b.type === "text")?.text?.trim() ?? "";
  return {
    text,
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0
  };
}

async function visionGoogle(
  model: string,
  prompt: string,
  jpegBase64: string
): Promise<{
  text: string;
  input_tokens: number;
  output_tokens: number;
}> {
  const key = googleKey();
  if (!key) throw new Error("키 없음");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: jpegBase64
              }
            }
          ]
        }
      ],
      generationConfig: { maxOutputTokens: 700 }
    })
  });
  if (!res.ok) {
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 280)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";
  return {
    text,
    input_tokens: json.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0
  };
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

/** 품질·비용 휴리스틱 추천 (사람이 HTML로 최종 확인) */
function suggestRecommendation(rows: CompareRow[]): {
  model_id: string | null;
  reason: string;
} {
  const ok = rows.filter((r) => r.status === "ok" && r.cost_usd_1 != null);
  if (ok.length === 0) {
    return { model_id: null, reason: "성공한 모델이 없어 추천 불가" };
  }
  const scored = ok.map((r) => {
    const descLen = (r.description ?? "").length;
    const lenScore =
      descLen >= 80 && descLen <= 220 ? 2 : descLen >= 40 ? 1 : 0;
    const termScore = Math.min(3, r.term_count);
    const categoryBonus = r.ai_category === "field_photo" ? 1 : 0;
    const cost = r.cost_usd_1 ?? 1;
    // 비용이 낮을수록 가점. sonnet(~$0.01)보다 싸면 가산
    const costScore = cost <= 0.002 ? 4 : cost <= 0.005 ? 3 : cost <= 0.015 ? 2 : 1;
    return {
      r,
      score: lenScore + termScore + categoryBonus + costScore,
      cost
    };
  });
  scored.sort((a, b) => b.score - a.score || a.cost - b.cost);
  const best = scored[0]!.r;
  return {
    model_id: best.model_id,
    reason: `휴리스틱: 설명 길이·아폴론용어·분류·1장 비용($${(best.cost_usd_1 ?? 0).toFixed(4)}) 종합. HTML에서 설명 품질을 눈으로 확인한 뒤 확정할 것.`
  };
}

function writeHtml(opts: {
  imageRel: string;
  imagePath: string;
  promptPreview: string;
  rows: CompareRow[];
  recommendation: { model_id: string | null; reason: string };
  outPath: string;
}) {
  const { rows } = opts;
  const bodyRows = rows
    .map((r) => {
      const st =
        r.status === "ok"
          ? "ok"
          : r.status === "no_key"
            ? "nokey"
            : "err";
      return `<tr class="${st}">
  <td><strong>${esc(r.model_label)}</strong><br><code>${esc(r.model_id)}</code></td>
  <td class="desc">${r.status === "ok" ? esc(r.description ?? "") : esc(r.error ?? r.status)}</td>
  <td>${r.input_tokens || "—"}</td>
  <td>${r.output_tokens || "—"}</td>
  <td>${money(r.cost_usd_1)}</td>
  <td>${r.elapsed_ms != null ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : "—"}</td>
  <td>${r.status === "ok" ? r.term_count : "—"}</td>
</tr>`;
    })
    .join("\n");

  const scaleRows = rows
    .map((r) => {
      if (r.status !== "ok") {
        return `<tr><td>${esc(r.model_label)}</td><td colspan="4">${esc(r.error ?? r.status)}</td></tr>`;
      }
      return `<tr>
  <td>${esc(r.model_label)}</td>
  <td>${money(r.cost_usd_10k)}</td>
  <td>${money(r.cost_usd_50k)}</td>
  <td>${money(r.cost_usd_150k)}</td>
  <td>${r.eta_50k_hours != null ? `${r.eta_50k_hours.toFixed(1)}h` : "—"}</td>
</tr>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>비전 모델 비교 — 1장</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#f3f1ec;color:#1a1b1f}
header{padding:20px 24px;background:#1a1b1f;color:#fff}
header h1{margin:0 0 6px;font-size:18px}
header p{margin:0;opacity:.75;font-size:13px}
.wrap{padding:20px 24px;max-width:1200px;margin:0 auto}
.hero{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px #0001;margin-bottom:18px}
.hero img{width:100%;max-height:420px;object-fit:contain;background:#111;border-radius:8px}
.hero .path{font-size:12px;color:#666;margin-top:10px;word-break:break-all}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px #0001;margin-bottom:18px;font-size:13px}
th,td{padding:10px 12px;border-bottom:1px solid #eceae4;vertical-align:top;text-align:left}
th{background:#f7f5f0;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#666}
td.desc{max-width:420px;line-height:1.5}
tr.nokey{opacity:.55} tr.err td.desc{color:#9b1c1c}
.rec{background:#eef6ff;border:1px solid #c5daf5;border-radius:12px;padding:14px 16px;margin-bottom:18px}
.rec strong{display:block;margin-bottom:4px}
details{background:#fff;border-radius:12px;padding:12px 16px;margin-bottom:18px}
code{font-size:11px}
</style>
</head>
<body>
<header>
  <h1>비전 모델 비교 — 대표 이미지 1장</h1>
  <p>동일 프롬프트 · 단가는 lib/luna/model-pricing (설정 &gt; LUNA &gt; 모델 비용과 동일 소스)</p>
</header>
<div class="wrap">
  <div class="hero">
    <img src="${esc(opts.imageRel)}" alt="대표 이미지"/>
    <div class="path">${esc(opts.imagePath)}</div>
  </div>
  <div class="rec">
    <strong>휴리스틱 추천: ${esc(opts.recommendation.model_id ?? "(없음)")}</strong>
    ${esc(opts.recommendation.reason)}
  </div>
  <table>
    <thead><tr>
      <th>모델</th><th>설명</th><th>입력토큰</th><th>출력토큰</th><th>비용(1장)</th><th>소요시간</th><th>아폴론용어</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <h2 style="font-size:15px">환산표</h2>
  <table>
    <thead><tr>
      <th>모델</th><th>1만장</th><th>5만장</th><th>15만장</th><th>예상시간(5만장)</th>
    </tr></thead>
    <tbody>${scaleRows}</tbody>
  </table>
  <details>
    <summary>사용한 프롬프트 (일부)</summary>
    <pre style="white-space:pre-wrap;font-size:11px">${esc(opts.promptPreview.slice(0, 2500))}</pre>
  </details>
</div>
</body></html>`;
  writeFileSync(opts.outPath, html, "utf8");
}

async function main() {
  const { image } = parseArgs(process.argv.slice(2));
  const outDir = resolve(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });

  console.log("=== vision model compare ===");
  console.log("image:", image);

  if (!existsSync(image)) {
    console.error(
      "이미지가 없습니다. 회사 PC에서 T: 를 연 뒤 실행하세요.\n" +
        "  npx tsx scripts/vision-model-compare.ts"
    );
    process.exit(1);
  }

  const sharp = await loadSharp();
  if (!sharp) {
    console.error("sharp 필요: npm i sharp");
    process.exit(1);
  }

  const jpeg = await sharp(image, { failOn: "none" })
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const b64 = jpeg.toString("base64");

  const previewPath = join(outDir, "vision-model-compare-preview.jpg");
  await sharp(jpeg).jpeg({ quality: 85 }).toFile(previewPath);

  const parts = parseMediaPath(image);
  const folderCategory = classifyFolderCategory(image);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null;

  const glossary = admin ? await loadVisualGlossary(admin) : [];
  const glossaryBlock = formatGlossaryBlock(glossary);
  const projectContext = admin
    ? await loadNotionProjectContexts(admin, "삼성디스플레이")
    : null;

  console.log("glossary:", glossary.length, "notion context:", Boolean(projectContext));
  console.log("keys:", {
    openai: Boolean(openaiKey()),
    anthropic: Boolean(anthropicKey()),
    google: Boolean(googleKey())
  });

  const prompt = buildMediaVisionPrompt({
    path: image,
    parts,
    folderCategory,
    glossary: glossaryBlock,
    projectContext
  });

  const rows: CompareRow[] = [];

  for (const m of COMPARE_MODELS) {
    const price = resolveOfficialPrice(m.model_id);
    const base: CompareRow = {
      provider: m.provider,
      model_id: m.model_id,
      model_label: m.model_label,
      status: "ok",
      description: null,
      purpose: null,
      author: null,
      ai_category: null,
      terms_used: [],
      term_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd_1: null,
      cost_usd_10k: null,
      cost_usd_50k: null,
      cost_usd_150k: null,
      elapsed_ms: null,
      eta_50k_hours: null,
      price_in_per_m: price?.input ?? null,
      price_out_per_m: price?.output ?? null,
      error: null
    };

    if (!keyFor(m.provider)) {
      rows.push({
        ...base,
        status: "no_key",
        error: "키 없음"
      });
      console.log("SKIP", m.model_id, "키 없음");
      continue;
    }

    const t0 = Date.now();
    try {
      let raw: { text: string; input_tokens: number; output_tokens: number };
      if (m.provider === "openai") {
        raw = await visionOpenAI(m.model_id, prompt, b64);
      } else if (m.provider === "anthropic") {
        raw = await visionAnthropic(m.model_id, prompt, b64);
      } else {
        raw = await visionGoogle(m.model_id, prompt, b64);
      }
      const elapsed = Date.now() - t0;
      const parsed = parseMediaVisionJson(raw.text);
      const cost1 = estimateUsd(
        m.model_id,
        raw.input_tokens,
        raw.output_tokens
      );
      rows.push({
        ...base,
        status: "ok",
        description: parsed.description,
        purpose: parsed.purpose,
        author: parsed.author,
        ai_category: parsed.ai_category,
        terms_used: parsed.terms_used,
        term_count: parsed.terms_used.length,
        input_tokens: raw.input_tokens,
        output_tokens: raw.output_tokens,
        cost_usd_1: cost1,
        cost_usd_10k: cost1 != null ? cost1 * 10_000 : null,
        cost_usd_50k: cost1 != null ? cost1 * 50_000 : null,
        cost_usd_150k: cost1 != null ? cost1 * 150_000 : null,
        elapsed_ms: elapsed,
        eta_50k_hours: (elapsed / 1000) * 50_000 / 3600,
        error: null
      });
      console.log(
        "OK",
        m.model_id,
        `${(elapsed / 1000).toFixed(1)}s`,
        money(cost1),
        `terms=${parsed.terms_used.length}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({
        ...base,
        status: msg.includes("키 없음") ? "no_key" : "error",
        elapsed_ms: Date.now() - t0,
        error: msg.slice(0, 400)
      });
      console.log("ERR", m.model_id, msg.slice(0, 120));
    }
  }

  const recommendation = suggestRecommendation(rows);
  const payload = {
    meta: {
      image,
      image_preview: previewPath,
      folder_category: folderCategory,
      path_summary: parts.summary,
      glossary_count: glossary.length,
      has_notion_context: Boolean(projectContext),
      keys: {
        openai: Boolean(openaiKey()),
        anthropic: Boolean(anthropicKey()),
        google: Boolean(googleKey())
      },
      recommendation,
      generated_at: new Date().toISOString()
    },
    prompt,
    models: COMPARE_MODELS,
    rows
  };

  const jsonPath = join(outDir, "vision-model-compare.json");
  const htmlPath = join(outDir, "vision-model-compare.html");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeHtml({
    imageRel: "vision-model-compare-preview.jpg",
    imagePath: image,
    promptPreview: prompt,
    rows,
    recommendation,
    outPath: htmlPath
  });

  console.log("\n--- 보고 ---");
  console.log("1. 모델:");
  for (const r of rows) {
    console.log(
      `   - ${r.model_id}: ${r.status}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`
    );
  }
  console.log("2~5. 설명·비용·시간·용어 → HTML/JSON");
  console.log(
    "6. 추천:",
    recommendation.model_id,
    "—",
    recommendation.reason
  );
  console.log("\nWrote", jsonPath);
  console.log("Wrote", htmlPath);
  console.log("미리보기:", previewPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
