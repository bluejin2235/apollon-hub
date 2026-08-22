import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaGlossaryTerm } from "@/lib/luna/media-vision-prompt";
import { resolveOfficialPrice } from "@/lib/luna/model-pricing";

export const COMPARE_MODEL_ORDER = [
  "gpt-5.6-luna",
  "claude-haiku-4-5",
  "claude-opus-4-6"
] as const;

export type CompareModelResult = {
  description: string;
  category: string;
  purpose: string;
  author: string;
  terms_used: string[];
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
  cost_usd: number | null;
  error?: string;
};

export type CompareFileRow = {
  path: string;
  file_name: string;
  thumbnail_url: string | null;
  folder_category: string | null;
  models: Record<string, CompareModelResult>;
};

export type CompareModelRun = {
  model_id: string;
  file_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_elapsed_ms: number;
  total_cost_usd: number | null;
  per_image_cost_usd: number | null;
  ran_at: string;
};

export type MediaModelCompareDoc = {
  generated_at: string;
  file_count: number;
  scale_total: number;
  model_runs: CompareModelRun[];
  files: CompareFileRow[];
};

export type IndexedCompareRow = {
  path: string;
  drive: string;
  file_name: string;
  thumbnail_url: string | null;
  folder_category: string | null;
  description: string | null;
  ai_category: string | null;
  purpose: string | null;
  author: string | null;
  description_model: string | null;
};

export function compareJsonPath(cwd = process.cwd()): string {
  return join(cwd, "tmp", "media-model-compare.json");
}

export function compareHtmlPath(cwd = process.cwd()): string {
  return join(cwd, "tmp", "media-model-compare.html");
}

export function loadCompareDoc(cwd = process.cwd()): MediaModelCompareDoc | null {
  const file = compareJsonPath(cwd);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as MediaModelCompareDoc;
  } catch {
    return null;
  }
}

export function saveCompareDoc(doc: MediaModelCompareDoc, cwd = process.cwd()): void {
  mkdirSync(join(cwd, "tmp"), { recursive: true });
  doc.generated_at = new Date().toISOString();
  doc.file_count = doc.files.length;
  writeFileSync(compareJsonPath(cwd), JSON.stringify(doc, null, 2), "utf8");
}

export async function fetchIndexedCompareRows(
  admin: SupabaseClient,
  limit: number
): Promise<IndexedCompareRow[]> {
  const { data, error } = await admin
    .from("luna_media_index")
    .select(
      "path, drive, file_name, thumbnail_url, folder_category, description, ai_category, purpose, author, description_model"
    )
    .order("indexed_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as IndexedCompareRow[];
}

export function countGlossaryTermsInText(
  text: string,
  glossary: MediaGlossaryTerm[]
): string[] {
  const hay = text.toLowerCase();
  const used: string[] = [];
  for (const t of glossary) {
    const ko = (t.term_ko ?? "").trim();
    const en = (t.term_en ?? "").trim();
    if (ko && hay.includes(ko.toLowerCase())) used.push(ko);
    else if (en && hay.includes(en.toLowerCase())) used.push(ko || en);
  }
  return [...new Set(used)];
}

export function visionCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const price = resolveOfficialPrice(modelId);
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}

export function seedCompareDocFromIndex(
  rows: IndexedCompareRow[],
  glossary: MediaGlossaryTerm[],
  scaleTotal = 2230
): MediaModelCompareDoc {
  const files: CompareFileRow[] = rows.map((r) => {
    const text = [r.description, r.purpose].filter(Boolean).join("\n");
    const modelId = r.description_model ?? "gpt-5.6-luna";
    return {
      path: r.path,
      file_name: r.file_name,
      thumbnail_url: r.thumbnail_url,
      folder_category: r.folder_category,
      models: {
        [modelId]: {
          description: r.description ?? "",
          category: r.ai_category ?? "unknown",
          purpose: r.purpose ?? "",
          author: r.author ?? "",
          terms_used: countGlossaryTermsInText(text, glossary),
          input_tokens: 0,
          output_tokens: 0,
          elapsed_ms: 0,
          cost_usd: null
        }
      }
    };
  });
  return {
    generated_at: new Date().toISOString(),
    file_count: files.length,
    scale_total: scaleTotal,
    model_runs: [],
    files
  };
}

export function mergeCompareModelRun(
  doc: MediaModelCompareDoc,
  run: CompareModelRun
): void {
  const idx = doc.model_runs.findIndex((r) => r.model_id === run.model_id);
  if (idx >= 0) doc.model_runs[idx] = run;
  else doc.model_runs.push(run);
}

export function resolveMediaFilePath(drive: string, relativePath: string): string {
  const full = `${drive}:\\${relativePath}`;
  if (existsSync(full)) return full;
  const unc =
    drive.toUpperCase() === "P"
      ? process.env.SCAN_UNC_P?.trim()
      : process.env.SCAN_UNC_T?.trim();
  if (unc) {
    const uncFull = join(unc.replace(/\\+$/, ""), relativePath);
    if (existsSync(uncFull)) return uncFull;
  }
  return full;
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

export function writeCompareHtml(doc: MediaModelCompareDoc, cwd = process.cwd()): string {
  const out = compareHtmlPath(cwd);
  const models = COMPARE_MODEL_ORDER.filter((m) =>
    doc.files.some((f) => f.models[m])
  );

  const summaryRows = COMPARE_MODEL_ORDER.map((modelId) => {
    const run = doc.model_runs.find((r) => r.model_id === modelId);
    if (!run) {
      const hasDesc = doc.files.some((f) => f.models[modelId]?.description);
      if (!hasDesc) return "";
      return `<tr><td>${esc(modelId)}</td><td colspan="5">(index batch — token stats in model_runs 없음)</td></tr>`;
    }
    const sec = (run.total_elapsed_ms / 1000).toFixed(1);
    const terms = doc.files.reduce(
      (n, f) => n + (f.models[modelId]?.terms_used.length ?? 0),
      0
    );
    return `<tr>
  <td><code>${esc(modelId)}</code></td>
  <td>${run.total_input_tokens.toLocaleString("ko-KR")}</td>
  <td>${run.total_output_tokens.toLocaleString("ko-KR")}</td>
  <td>${money(run.total_cost_usd)}</td>
  <td>${sec}s</td>
  <td>${terms}</td>
</tr>`;
  }).join("\n");

  const bodyRows = doc.files
    .map((f) => {
      const thumb = f.thumbnail_url
        ? `<img src="${esc(f.thumbnail_url)}" alt="" width="120"/>`
        : "—";
      const modelCells = models
        .map((m) => {
          const r = f.models[m];
          if (!r) return "<td class='desc'>—</td>";
          if (r.error) {
            return `<td class="desc err">${esc(r.error)}</td>`;
          }
          const terms =
            r.terms_used.length > 0
              ? `<div class="terms">${r.terms_used.map(esc).join(", ")}</div>`
              : "";
          return `<td class="desc"><span class="cat">${esc(r.category)}</span> ${esc(r.description)}${terms}</td>`;
        })
        .join("");
      return `<tr>
  <td class="thumb">${thumb}</td>
  <td class="path"><code>${esc(f.path)}</code></td>
  ${modelCells}
</tr>`;
    })
    .join("\n");

  const scale = doc.scale_total;
  const scaleRows = COMPARE_MODEL_ORDER.map((modelId) => {
    const run = doc.model_runs.find((r) => r.model_id === modelId);
    if (!run?.per_image_cost_usd) return "";
    const total = run.per_image_cost_usd * scale;
    const hours =
      run.file_count > 0
        ? ((run.total_elapsed_ms / run.file_count) * scale) / 3_600_000
        : null;
    return `<tr>
  <td><code>${esc(modelId)}</code></td>
  <td>${money(total)}</td>
  <td>${hours != null ? `${hours.toFixed(1)}h` : "—"}</td>
</tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>미디어 색인 — 비전 모델 3종 비교 (${doc.file_count}장)</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#f3f1ec;color:#1a1b1f}
header{padding:20px 24px;background:#1a1b1f;color:#fff}
header h1{margin:0 0 6px;font-size:18px}
header p{margin:0;opacity:.75;font-size:13px}
.wrap{padding:16px 20px;overflow-x:auto}
table{border-collapse:collapse;background:#fff;box-shadow:0 1px 4px #0001;font-size:12px;margin-bottom:20px}
th,td{padding:8px 10px;border:1px solid #eceae4;vertical-align:top;text-align:left}
th{background:#f7f5f0;font-size:11px;position:sticky;top:0}
td.thumb{width:130px}
td.path{max-width:220px;word-break:break-all;font-size:11px}
td.desc{max-width:280px;line-height:1.45}
.cat{display:inline-block;background:#eee;padding:1px 6px;border-radius:4px;font-size:10px;margin-right:4px}
.terms{margin-top:6px;font-size:10px;color:#666}
.err{color:#9b1c1c}
h2{font-size:14px;margin:18px 0 8px}
</style>
</head>
<body>
<header>
  <h1>비전 모델 3종 비교 — ${doc.file_count}장</h1>
  <p>동일 파일 · gpt-5.6-luna(luna_media_index) + compare 실행 결과</p>
</header>
<div class="wrap">
  <h2>모델별 집계</h2>
  <table>
    <thead><tr>
      <th>모델</th><th>입력 토큰</th><th>출력 토큰</th><th>비용</th><th>소요</th><th>용어 사용(합)</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <h2>${scale.toLocaleString("ko-KR")}장 확대 예상</h2>
  <table>
    <thead><tr><th>모델</th><th>예상 비용</th><th>예상 시간(순차)</th></tr></thead>
    <tbody>${scaleRows || "<tr><td colspan='3'>compare 실행 후 표시</td></tr>"}</tbody>
  </table>
  <h2>파일별 비교</h2>
  <table>
    <thead><tr>
      <th>썸네일</th><th>경로</th>${models.map((m) => `<th>${esc(m)}</th>`).join("")}
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</div>
</body></html>`;
  writeFileSync(out, html, "utf8");
  return out;
}

export function printCompareReport(doc: MediaModelCompareDoc): void {
  const scale = doc.scale_total;
  console.log("\n=== media model compare report ===\n");

  console.log("1. 모델별 토큰·비용·소요 시간");
  for (const modelId of COMPARE_MODEL_ORDER) {
    const run = doc.model_runs.find((r) => r.model_id === modelId);
    if (run) {
      console.log(
        `  ${modelId}: in=${run.total_input_tokens.toLocaleString("ko-KR")} out=${run.total_output_tokens.toLocaleString("ko-KR")} cost=${money(run.total_cost_usd)} time=${(run.total_elapsed_ms / 1000).toFixed(1)}s`
      );
    } else {
      const n = doc.files.filter((f) => f.models[modelId]?.description).length;
      if (n > 0) {
        console.log(`  ${modelId}: ${n}장 설명 (index batch, token stats 별도)`);
      }
    }
  }

  console.log(`\n2. ${scale.toLocaleString("ko-KR")}장 확대 예상 비용`);
  for (const modelId of COMPARE_MODEL_ORDER) {
    const run = doc.model_runs.find((r) => r.model_id === modelId);
    if (run?.per_image_cost_usd != null) {
      console.log(
        `  ${modelId}: ${money(run.per_image_cost_usd * scale)} (장당 ${money(run.per_image_cost_usd)})`
      );
    }
  }

  console.log("\n3. 아폴론 용어 사용 (파일당 평균)");
  for (const modelId of COMPARE_MODEL_ORDER) {
    const counts = doc.files.map((f) => f.models[modelId]?.terms_used.length ?? 0);
    if (counts.every((c) => c === 0)) continue;
    const sum = counts.reduce((a, b) => a + b, 0);
    console.log(
      `  ${modelId}: 합 ${sum} · 평균 ${(sum / counts.length).toFixed(1)}/장`
    );
  }

  console.log("\n4. 설명이 다른 사례 (최대 3)");
  const ranked = doc.files
    .map((f) => {
      const descs = COMPARE_MODEL_ORDER.map((m) =>
        (f.models[m]?.description ?? "").replace(/\s+/g, " ").trim()
      ).filter(Boolean);
      const unique = new Set(descs);
      const snippets: Record<string, string> = {};
      for (const m of COMPARE_MODEL_ORDER) {
        const d = f.models[m]?.description;
        if (d) snippets[m] = d.slice(0, 160);
      }
      return { path: f.path, file: f.file_name, unique: unique.size, snippets };
    })
    .filter((d) => d.unique >= 2)
    .sort((a, b) => b.unique - a.unique)
    .slice(0, 3);

  if (ranked.length === 0) {
    console.log("  (차이 큰 사례 없음 — compare 모델을 더 실행하세요)");
  } else {
    for (const d of ranked) {
      console.log(`\n  ${d.file} (서로 다른 설명 ${d.unique}종)`);
      console.log(`  ${d.path}`);
      for (const m of COMPARE_MODEL_ORDER) {
        if (d.snippets[m]) console.log(`    [${m}] ${d.snippets[m]}`);
      }
      console.log(
        "    → 판단: 공간·용도가 보이는 이미지는 구체적 묘사가 긴 쪽, PBR 맵·텍스처는 재질 채널을 짚은 쪽이 검색에 유용"
      );
    }
  }
  console.log("");
}