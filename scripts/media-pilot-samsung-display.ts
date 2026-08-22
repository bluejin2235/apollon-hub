/**
 * 삼성디스플레이 프로젝트 이미지 색인 시범
 *
 * 회사 PC (T: 보이는 세션)에서:
 *   npx tsx scripts/media-pilot-samsung-display.ts
 *
 * 옵션:
 *   --limit=20          장수 제한 (시범)
 *   --cheap-only        저가 모델만
 *   --premium-only      고성능만
 *   --skip-vision       경로·분류·썸네일만 (비전 API 없음)
 *   --concurrency=3
 *   --root="T:\\..."    대상 폴더 덮어쓰기
 *
 * 결과: tmp/media-pilot-result.json · tmp/media-pilot-result.html
 *       tmp/media-pilot-thumbs/ · tmp/media-pilot-report.md
 *
 * DB·원본·nas_directory 수정 없음. 읽기만.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync
} from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyFolderCategory,
  GLOSSARY_VISUAL_NEEDLES,
  isMeaninglessFileName,
  parseMediaPath,
  pathParseSuccessFlags,
  shouldExcludePath,
  type FolderCategory,
  type MediaPathParts
} from "../lib/luna/media-path-parse";
import {
  resolveOfficialPrice,
  type OfficialModelPrice
} from "../lib/luna/model-pricing";

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

const DEFAULT_ROOT =
  "T:\\02 Project\\2025\\250324 삼성디스플레이 신사옥 로비 미디어콘텐츠";

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".heic",
  ".psd",
  ".ai"
]);

const DOC_EXTS = new Set([".pptx", ".ppt", ".docx", ".doc", ".pdf"]);
const MIN_BYTES = 100 * 1024;
const CHEAP_MODEL = process.env.MEDIA_PILOT_CHEAP_MODEL || "gpt-4o-mini";
const PREMIUM_MODEL =
  process.env.MEDIA_PILOT_PREMIUM_MODEL || "claude-sonnet-4-6";

type VisionResult = {
  description: string;
  purpose: string;
  author: string;
  ai_category: string;
  terms_used: string[];
  input_tokens: number;
  output_tokens: number;
};

type PilotRow = {
  path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  path_parts: MediaPathParts;
  folder_category: FolderCategory;
  ai_category: string | null;
  purpose: string | null;
  author: string | null;
  project_context: string | null;
  related_docs: string[];
  desc_cheap: string | null;
  desc_premium: string | null;
  thumbnail_path: string | null;
  meaningless_name: boolean;
  terms_used: string[];
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
};

type GlossaryTerm = { term_ko: string; term_en: string | null; definition: string };

function parseArgs(argv: string[]) {
  const opts = {
    limit: 0,
    cheapOnly: false,
    premiumOnly: false,
    skipVision: false,
    concurrency: 3,
    root: DEFAULT_ROOT
  };
  for (const a of argv) {
    if (a.startsWith("--limit=")) opts.limit = Number(a.slice(8)) || 0;
    else if (a === "--cheap-only") opts.cheapOnly = true;
    else if (a === "--premium-only") opts.premiumOnly = true;
    else if (a === "--skip-vision") opts.skipVision = true;
    else if (a.startsWith("--concurrency="))
      opts.concurrency = Math.max(1, Number(a.slice(14)) || 3);
    else if (a.startsWith("--root=")) opts.root = a.slice(7);
  }
  return opts;
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (shouldExcludePath(full)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (/00\s*Management/i.test(name)) continue;
        stack.push(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

async function loadSharp(): Promise<typeof import("sharp") | null> {
  try {
    return (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    try {
      // next 의존성으로 들어온 sharp
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("sharp");
    } catch {
      return null;
    }
  }
}

function anthropicKey(): string | null {
  return (
    process.env.hubtrendchat_claude?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    null
  );
}

function openaiKey(): string | null {
  return (
    process.env.LUNA_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null
  );
}

async function loadGlossary(admin: SupabaseClient): Promise<GlossaryTerm[]> {
  const needles = [...GLOSSARY_VISUAL_NEEDLES];
  const { data, error } = await admin
    .from("glossary_terms")
    .select("term_ko, term_en, definition, deleted_at")
    .not("definition", "is", null)
    .limit(2000);
  if (error) {
    console.warn("[glossary]", error.message);
    return [];
  }
  const rows = (data ?? []).filter((r) => !r.deleted_at && r.definition?.trim());
  const hit: GlossaryTerm[] = [];
  for (const r of rows) {
    const hay = `${r.term_ko ?? ""} ${r.term_en ?? ""}`;
    if (needles.some((n) => hay.includes(n))) {
      hit.push({
        term_ko: r.term_ko,
        term_en: r.term_en,
        definition: String(r.definition).slice(0, 120)
      });
    }
  }
  return hit.slice(0, 50);
}

function formatGlossaryBlock(terms: GlossaryTerm[]): string {
  if (terms.length === 0) return "(용어 없음)";
  return terms
    .map((t) => {
      const en = t.term_en ? ` (${t.term_en})` : "";
      return `- ${t.term_ko}${en} — ${t.definition}`;
    })
    .join("\n");
}

async function loadNotionContext(
  admin: SupabaseClient,
  projectFolder: string
): Promise<Map<string, string>> {
  /** page_id -> short context */
  const map = new Map<string, string>();
  const needle = projectFolder.replace(/^[A-Za-z]:\\/, "").slice(0, 80);
  const { data: pages, error } = await admin
    .from("luna_notion_pages")
    .select("page_id, title, nas_path")
    .not("nas_path", "is", null)
    .ilike("nas_path", `%${needle.split("\\").slice(-1)[0] ?? "삼성디스플레이"}%`)
    .limit(40);
  if (error) {
    console.warn("[notion pages]", error.message);
    return map;
  }
  for (const p of pages ?? []) {
    const { data: chunks } = await admin
      .from("luna_notion_chunks")
      .select("text, heading")
      .eq("page_id", p.page_id)
      .order("position", { ascending: true })
      .limit(4);
    const body = (chunks ?? [])
      .map((c) => `${c.heading ? `[${c.heading}] ` : ""}${(c.text ?? "").slice(0, 280)}`)
      .join("\n")
      .slice(0, 900);
    if (body.trim()) {
      map.set(p.page_id, `「${p.title}」\n${body}`);
    }
  }
  return map;
}

function pickNotionContext(
  contexts: Map<string, string>,
  filePath: string
): string | null {
  if (contexts.size === 0) return null;
  // 경로에 프로젝트명이 있으면 전부 합쳐 짧게
  const all = [...contexts.values()].slice(0, 2).join("\n---\n");
  return all.slice(0, 1200) || null;
}

async function loadRelatedDocs(
  admin: SupabaseClient,
  filePath: string
): Promise<string[]> {
  const n = filePath.replace(/\//g, "\\");
  const drive = (n.match(/^([A-Za-z]):/)?.[1] ?? "T").toUpperCase();
  const abs = n.replace(/^[A-Za-z]:\\/, "");
  const parents: string[] = [];
  let cur = dirname(abs);
  for (let i = 0; i < 4; i++) {
    parents.push(cur);
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }

  const docs: string[] = [];
  for (const folder of parents) {
    const { data, error } = await admin
      .from("nas_directory")
      .select("path, type")
      .eq("drive", drive)
      .gte("path", `${folder}\\`)
      .lt("path", `${folder}\\\uFFFF`)
      .limit(80);
    if (error) continue;
    for (const row of data ?? []) {
      const ext = extname(row.path).toLowerCase();
      if (!DOC_EXTS.has(ext)) continue;
      // same folder or immediate child only
      const rel = row.path.slice(folder.length).replace(/^\\/, "");
      if (rel.includes("\\") && rel.split("\\").length > 2) continue;
      docs.push(`${drive}:\\${row.path}`);
      if (docs.length >= 3) return docs;
    }
    if (docs.length >= 3) break;
  }
  return docs.slice(0, 3);
}

function buildVisionPrompt(opts: {
  path: string;
  parts: MediaPathParts;
  folderCategory: FolderCategory;
  glossary: string;
  projectContext: string | null;
}): string {
  return `당신은 아폴론(미디어·공간 디자인) 아카이브 사서다. 이미지를 보고 JSON만 답한다.

[전체 경로]
${opts.path}

[경로 해석]
${opts.parts.summary}
- 최상위: ${opts.parts.rootClass ?? "-"}
- 연도: ${opts.parts.year ?? "-"}
- 프로젝트: ${opts.parts.project ?? "-"}
- 단계: ${opts.parts.stageCode ?? "-"} ${opts.parts.stageName ?? ""}
- 주체: ${opts.parts.actor ?? "-"} (${opts.parts.actorKind ?? "-"})
- 날짜/차수: ${opts.parts.dateToken ?? "-"} / ${opts.parts.variant ?? "-"}
- 작업: ${opts.parts.workKind ?? "-"}
- 폴더규칙 분류(참고): ${opts.folderCategory}

[프로젝트 노션 맥락 — 있으면 활용, 없으면 무시]
${opts.projectContext ?? "(없음)"}

[아폴론 용어 — 해당할 때만 쓰고 억지로 끼워넣지 마라]
${opts.glossary}

분류(ai_category) 후보: reference | provided | our_design | field_photo | field_test | unclassified
- 폴더에 「레퍼런스」가 있어도 홍보·포트폴리오·still cut 이면 field_photo 일 수 있다.

JSON 스키마:
{
  "description": "이미지 자체 설명 100~200자 한국어",
  "purpose": "용도 한 줄 (경로+이미지)",
  "author": "누가 (아폴론/협력사/이니셜)",
  "ai_category": "위 후보 중 하나",
  "terms_used": ["쓴 아폴론 용어 term_ko 배열, 없으면 []"]
}`;
}

function parseVisionJson(text: string): Partial<VisionResult> {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { description: t.slice(0, 240) };
  try {
    const v = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    return {
      description: String(v.description ?? "").slice(0, 400),
      purpose: String(v.purpose ?? "").slice(0, 200),
      author: String(v.author ?? "").slice(0, 80),
      ai_category: String(v.ai_category ?? "unclassified"),
      terms_used: Array.isArray(v.terms_used)
        ? v.terms_used.filter((x): x is string => typeof x === "string").slice(0, 12)
        : []
    };
  } catch {
    return { description: t.slice(0, 240) };
  }
}

async function visionOpenAI(
  model: string,
  prompt: string,
  jpegBase64: string
): Promise<VisionResult> {
  const key = openaiKey();
  if (!key) throw new Error("LUNA_OPENAI_API_KEY / OPENAI_API_KEY 없음");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
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
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseVisionJson(text);
  return {
    description: parsed.description ?? "",
    purpose: parsed.purpose ?? "",
    author: parsed.author ?? "",
    ai_category: parsed.ai_category ?? "unclassified",
    terms_used: parsed.terms_used ?? [],
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0
  };
}

async function visionAnthropic(
  model: string,
  prompt: string,
  jpegBase64: string
): Promise<VisionResult> {
  const key = anthropicKey();
  if (!key) throw new Error("hubtrendchat_claude / ANTHROPIC_API_KEY 없음");
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
  const parsed = parseVisionJson(text);
  return {
    description: parsed.description ?? "",
    purpose: parsed.purpose ?? "",
    author: parsed.author ?? "",
    ai_category: parsed.ai_category ?? "unclassified",
    terms_used: parsed.terms_used ?? [],
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return out;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeHtml(rows: PilotRow[], outPath: string, thumbRelBase: string) {
  const cats = [
    "all",
    "reference",
    "provided",
    "our_design",
    "field_photo",
    "field_test",
    "unclassified",
    "exclude"
  ];
  const cards = rows
    .filter((r) => !r.skipped)
    .map((r, i) => {
      const thumb = r.thumbnail_path
        ? relative(dirname(outPath), r.thumbnail_path).replace(/\\/g, "/")
        : "";
      const mismatch =
        r.ai_category && r.folder_category !== r.ai_category
          ? "mismatch"
          : "";
      return `<article class="card" data-folder="${escHtml(r.folder_category)}" data-ai="${escHtml(r.ai_category ?? "")}" data-i="${i}">
  <div class="thumb">${thumb ? `<img src="${escHtml(thumb)}" loading="lazy" alt="">` : "<div class='empty'>no thumb</div>"}</div>
  <div class="meta">
    <div class="path">${escHtml(r.path_parts.summary || r.path)}</div>
    <div class="tags">
      <span class="tag">폴더:${escHtml(r.folder_category)}</span>
      <span class="tag ${mismatch}">AI:${escHtml(r.ai_category ?? "-")}</span>
      <span class="tag">${escHtml(r.purpose ?? "")}</span>
    </div>
    <div class="who">${escHtml(r.author ?? r.path_parts.actor ?? "")}</div>
    <div class="cols">
      <div><h4>저가</h4><p>${escHtml(r.desc_cheap ?? "")}</p></div>
      <div><h4>고성능</h4><p>${escHtml(r.desc_premium ?? "")}</p></div>
    </div>
    <div class="docs">${escHtml((r.related_docs ?? []).join(" · "))}</div>
    <div class="file">${escHtml(r.file_name)} · ${(r.file_size / 1024).toFixed(0)}KB</div>
  </div>
</article>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<title>미디어 시범 — 삼성디스플레이</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#f4f2ee;color:#1c1d21}
header{position:sticky;top:0;background:#1c1d21;color:#fff;padding:12px 18px;z-index:2}
header h1{font-size:16px;margin:0 0 8px}
.filters button{margin:2px;padding:4px 10px;border-radius:6px;border:0;cursor:pointer}
.filters button.on{background:#7c6cff;color:#fff}
main{padding:16px;display:flex;flex-direction:column;gap:14px}
.card{display:grid;grid-template-columns:200px 1fr;gap:14px;background:#fff;border-radius:12px;padding:12px;box-shadow:0 1px 3px #0001}
.thumb img{width:200px;height:140px;object-fit:cover;border-radius:8px;background:#eee}
.thumb .empty{width:200px;height:140px;background:#e8e6e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px}
.path{font-size:13px;font-weight:600;margin-bottom:6px}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.tag{font-size:11px;background:#eef0f3;padding:2px 7px;border-radius:4px}
.tag.mismatch{background:#fde8e8;color:#9b1c1c}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
.cols h4{margin:0 0 4px;font-size:11px;color:#666}
.cols p{margin:0;font-size:12.5px;line-height:1.55}
.docs,.file,.who{font-size:11px;color:#6b6f76;margin-top:6px}
@media(max-width:800px){.card{grid-template-columns:1fr}.cols{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>삼성디스플레이 로비 — 이미지 시범 ${rows.filter((r) => !r.skipped).length}장</h1>
  <div class="filters" id="filters">
    ${cats.map((c) => `<button data-cat="${c}" class="${c === "all" ? "on" : ""}">${c}</button>`).join("")}
  </div>
</header>
<main id="list">${cards}</main>
<script>
const buttons=[...document.querySelectorAll('.filters button')];
const cards=[...document.querySelectorAll('.card')];
buttons.forEach(b=>b.addEventListener('click',()=>{
  buttons.forEach(x=>x.classList.remove('on')); b.classList.add('on');
  const cat=b.dataset.cat;
  cards.forEach(c=>{
    const show=cat==='all'||c.dataset.folder===cat||c.dataset.ai===cat;
    c.style.display=show?'grid':'none';
  });
}));
</script>
</body></html>`;
  writeFileSync(outPath, html, "utf8");
  void thumbRelBase;
}

function sampleRows(rows: PilotRow[], n: number): PilotRow[] {
  const usable = rows.filter((r) => !r.skipped && (r.desc_cheap || r.desc_premium));
  if (usable.length <= n) return usable;
  const step = Math.floor(usable.length / n);
  const out: PilotRow[] = [];
  for (let i = 0; i < n; i++) out.push(usable[Math.min(i * step, usable.length - 1)]!);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root;
  const outDir = resolve(process.cwd(), "tmp");
  const thumbDir = join(outDir, "media-pilot-thumbs");
  mkdirSync(thumbDir, { recursive: true });

  console.log("=== media pilot ===");
  console.log("root:", root);
  if (!existsSync(root)) {
    console.error(
      "대상 폴더가 없습니다. 회사 PC에서 T: 를 연 뒤 다시 실행하세요.\n" +
        `  npx tsx scripts/media-pilot-samsung-display.ts`
    );
    process.exit(1);
  }

  const sharp = await loadSharp();
  if (!sharp) {
    console.warn("sharp 없음 — npm i sharp 권장. 썸네일·리사이즈가 제한됩니다.");
  }

  const t0 = Date.now();
  const allFiles = walkFiles(root);
  const candidates: { path: string; size: number; ext: string }[] = [];
  const skipped: PilotRow[] = [];
  const psdAiStats = { total: 0, thumbOk: 0, thumbFail: 0 };

  for (const f of allFiles) {
    const ext = extname(f).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    if (shouldExcludePath(f)) {
      skipped.push(makeSkip(f, "exclude_path"));
      continue;
    }
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      skipped.push(makeSkip(f, "stat_fail"));
      continue;
    }
    if (size < MIN_BYTES) {
      skipped.push(makeSkip(f, "under_100kb", size));
      continue;
    }
    if (ext === ".psd" || ext === ".ai") psdAiStats.total += 1;
    candidates.push({ path: f, size, ext });
  }

  let work = candidates;
  if (opts.limit > 0) work = work.slice(0, opts.limit);
  console.log(
    `files scanned=${allFiles.length} images_ge_100kb=${candidates.length} process=${work.length}`
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null;

  const glossary = admin ? await loadGlossary(admin) : [];
  const glossaryBlock = formatGlossaryBlock(glossary);
  console.log("glossary terms:", glossary.length);

  const notionCtx = admin
    ? await loadNotionContext(admin, root)
    : new Map<string, string>();
  console.log("notion context pages:", notionCtx.size);

  let cheapTokens = { in: 0, out: 0 };
  let premiumTokens = { in: 0, out: 0 };
  let cheapMs = 0;
  let premiumMs = 0;

  const rows: PilotRow[] = [...skipped];

  await mapPool(work, opts.concurrency, async (item) => {
    const parts = parseMediaPath(item.path);
    const folder_category = classifyFolderCategory(item.path);
    const file_name = basename(item.path);
    const hash = createHash("md5").update(item.path).digest("hex").slice(0, 12);
    const thumbPath = join(thumbDir, `${hash}.jpg`);

    let width: number | null = null;
    let height: number | null = null;
    let jpeg640: Buffer | null = null;
    let error: string | null = null;

    try {
      if (sharp) {
        const pipe = sharp(item.path, {
          failOn: "none",
          density: item.ext === ".ai" || item.ext === ".psd" ? 72 : undefined
        });
        const meta = await pipe.metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
        jpeg640 = await sharp(item.path, { failOn: "none" })
          .rotate()
          .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        await sharp(jpeg640)
          .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toFile(thumbPath);
        if (item.ext === ".psd" || item.ext === ".ai") psdAiStats.thumbOk += 1;
      } else if (item.ext === ".psd" || item.ext === ".ai") {
        psdAiStats.thumbFail += 1;
        error = "sharp_unavailable_for_psd_ai";
      }
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 160) : "resize_fail";
      if (item.ext === ".psd" || item.ext === ".ai") psdAiStats.thumbFail += 1;
    }

    const project_context = pickNotionContext(notionCtx, item.path);
    const related_docs = admin
      ? await loadRelatedDocs(admin, item.path)
      : [];

    let desc_cheap: string | null = null;
    let desc_premium: string | null = null;
    let purpose: string | null = null;
    let author: string | null = parts.actor;
    let ai_category: string | null = null;
    let terms_used: string[] = [];

    const prompt = buildVisionPrompt({
      path: item.path,
      parts,
      folderCategory: folder_category,
      glossary: glossaryBlock,
      projectContext: project_context
    });

    if (!opts.skipVision && jpeg640) {
      const b64 = jpeg640.toString("base64");
      if (!opts.premiumOnly) {
        const t1 = Date.now();
        try {
          const v = await visionOpenAI(CHEAP_MODEL, prompt, b64);
          desc_cheap = v.description;
          purpose = v.purpose || purpose;
          author = v.author || author;
          ai_category = v.ai_category;
          terms_used = [...new Set([...terms_used, ...v.terms_used])];
          cheapTokens.in += v.input_tokens;
          cheapTokens.out += v.output_tokens;
        } catch (e) {
          error = (error ? error + "; " : "") +
            (e instanceof Error ? e.message : "cheap_fail");
        }
        cheapMs += Date.now() - t1;
      }
      if (!opts.cheapOnly) {
        const t2 = Date.now();
        try {
          const v = await visionAnthropic(PREMIUM_MODEL, prompt, b64);
          desc_premium = v.description;
          purpose = purpose || v.purpose;
          author = author || v.author;
          ai_category = ai_category || v.ai_category;
          terms_used = [...new Set([...terms_used, ...v.terms_used])];
          premiumTokens.in += v.input_tokens;
          premiumTokens.out += v.output_tokens;
        } catch (e) {
          error = (error ? error + "; " : "") +
            (e instanceof Error ? e.message : "premium_fail");
        }
        premiumMs += Date.now() - t2;
      }
    }

    const row: PilotRow = {
      path: item.path,
      file_name,
      file_type: item.ext.replace(".", ""),
      file_size: item.size,
      width,
      height,
      path_parts: parts,
      folder_category,
      ai_category,
      purpose,
      author,
      project_context,
      related_docs,
      desc_cheap,
      desc_premium,
      thumbnail_path: existsSync(thumbPath) ? thumbPath : null,
      meaningless_name: isMeaninglessFileName(file_name),
      terms_used,
      error,
      skipped: false,
      skip_reason: null
    };
    rows.push(row);
    if (rows.filter((r) => !r.skipped).length % 25 === 0) {
      console.log(
        "progress",
        rows.filter((r) => !r.skipped).length,
        "/",
        work.length
      );
    }
    return row;
  });

  const processed = rows.filter((r) => !r.skipped);
  const elapsedSec = (Date.now() - t0) / 1000;

  const cheapCost = estimateUsd(CHEAP_MODEL, cheapTokens.in, cheapTokens.out);
  const premCost = estimateUsd(
    PREMIUM_MODEL,
    premiumTokens.in,
    premiumTokens.out
  );

  // metrics
  const meaningless = processed.filter((r) => r.meaningless_name).length;
  let stageOk = 0;
  let actorOk = 0;
  let variantOk = 0;
  for (const r of processed) {
    const f = pathParseSuccessFlags(r.path_parts);
    if (f.hasStage) stageOk++;
    if (f.hasActor) actorOk++;
    if (f.hasVariantOrDate) variantOk++;
  }
  const mismatch = processed.filter(
    (r) => r.ai_category && r.ai_category !== r.folder_category
  );
  const termHit = processed.filter((r) => r.terms_used.length > 0).length;
  const notionHit = processed.filter((r) => Boolean(r.project_context)).length;
  const docHit = processed.filter((r) => r.related_docs.length > 0).length;

  const perImageSec =
    processed.length > 0 ? elapsedSec / processed.length : 0;
  const scale = (n: number) => ({
    hours: ((n * perImageSec) / 3600).toFixed(1),
    cheapUsd:
      cheapCost && processed.length
        ? ((cheapCost / processed.length) * n).toFixed(2)
        : "?",
    premUsd:
      premCost && processed.length
        ? ((premCost / processed.length) * n).toFixed(2)
        : "?"
  });

  const report = [
    "# 미디어 시범 보고 — 삼성디스플레이",
    "",
    `1. 실제 처리 장수: **${processed.length}** (100KB↑ · 제외 규칙 후 / 후보 ${candidates.length})`,
    `2. 시간·비용`,
    `   - 총 ${(elapsedSec / 60).toFixed(1)}분`,
    `   - ${CHEAP_MODEL}: ${(cheapMs / 1000).toFixed(0)}s · in ${cheapTokens.in} out ${cheapTokens.out} · $${cheapCost?.toFixed(4) ?? "?"}`,
    `   - ${PREMIUM_MODEL}: ${(premiumMs / 1000).toFixed(0)}s · in ${premiumTokens.in} out ${premiumTokens.out} · $${premCost?.toFixed(4) ?? "?"}`,
    `3. 샘플 15장은 HTML/JSON 참고`,
    `4. 무의미 파일명: ${meaningless}/${processed.length} (${pct(meaningless, processed.length)})`,
    `5. 경로 해석 — 단계 ${pct(stageOk, processed.length)} · 주체 ${pct(actorOk, processed.length)} · 차수/날짜 ${pct(variantOk, processed.length)}`,
    `6. 폴더≠AI 분류: ${mismatch.length}건`,
    ...mismatch.slice(0, 5).map(
      (m) =>
        `   - ${m.file_name}: folder=${m.folder_category} ai=${m.ai_category} · ${m.path_parts.summary}`
    ),
    `7. 아폴론 용어 사용: ${termHit}/${processed.length} (${pct(termHit, processed.length)})`,
    `8. 노션 맥락 ${pct(notionHit, processed.length)} · 관련문서 ${pct(docHit, processed.length)}`,
    `9. psd/ai 썸네일: ok ${psdAiStats.thumbOk} / fail ${psdAiStats.thumbFail} / total ${psdAiStats.total}`,
    `10. 스킵 ${rows.filter((r) => r.skipped).length} · 에러 ${processed.filter((r) => r.error).length}`,
    `11. 확대 추정 (현재 ${processed.length}장 기준)`,
    `   - 5만장: ~${scale(50_000).hours}h · cheap $${scale(50_000).cheapUsd} · prem $${scale(50_000).premUsd}`,
    `   - 15만장: ~${scale(150_000).hours}h · cheap $${scale(150_000).cheapUsd} · prem $${scale(150_000).premUsd}`,
    "",
    "## 샘플 15",
    ...sampleRows(processed, 15).map((r, i) =>
      [
        `### ${i + 1}. ${r.file_name}`,
        `- 경로: ${r.path_parts.summary}`,
        `- 분류: folder=${r.folder_category} ai=${r.ai_category}`,
        `- 저가: ${r.desc_cheap ?? "-"}`,
        `- 고성능: ${r.desc_premium ?? "-"}`
      ].join("\n")
    )
  ].join("\n");

  const jsonPath = join(outDir, "media-pilot-result.json");
  const htmlPath = join(outDir, "media-pilot-result.html");
  const reportPath = join(outDir, "media-pilot-report.md");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        meta: {
          root,
          processed: processed.length,
          candidates: candidates.length,
          elapsed_sec: elapsedSec,
          cheap_model: CHEAP_MODEL,
          premium_model: PREMIUM_MODEL,
          cheap_cost_usd: cheapCost,
          premium_cost_usd: premCost,
          glossary_count: glossary.length,
          notion_pages: notionCtx.size
        },
        rows
      },
      null,
      2
    ),
    "utf8"
  );
  writeHtml(rows, htmlPath, thumbDir);
  writeFileSync(reportPath, report, "utf8");
  console.log(report);
  console.log("\nWrote", jsonPath);
  console.log("Wrote", htmlPath);
  console.log("Wrote", reportPath);
}

function pct(n: number, d: number): string {
  if (!d) return "0%";
  return `${((100 * n) / d).toFixed(1)}%`;
}

function makeSkip(path: string, reason: string, size = 0): PilotRow {
  const parts = parseMediaPath(path);
  return {
    path,
    file_name: basename(path),
    file_type: extname(path).replace(".", ""),
    file_size: size,
    width: null,
    height: null,
    path_parts: parts,
    folder_category: classifyFolderCategory(path),
    ai_category: null,
    purpose: null,
    author: null,
    project_context: null,
    related_docs: [],
    desc_cheap: null,
    desc_premium: null,
    thumbnail_path: null,
    meaningless_name: isMeaninglessFileName(basename(path)),
    terms_used: [],
    error: null,
    skipped: true,
    skip_reason: reason
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
