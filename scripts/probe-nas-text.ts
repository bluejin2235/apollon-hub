/**
 * Work서버 문서 본문 추출 조사 — 저장·임베딩 없음. 세기만.
 *
 *   npx tsx scripts/probe-nas-text.ts --limit=200
 *
 * 회사 PC 대화형 세션(T:/P:)에서 실행.
 */
import { config } from "dotenv";
import { randomInt } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync
} from "node:fs";
import { extname } from "node:path";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Ext =
  | "pdf"
  | "pptx"
  | "xlsx"
  | "docx"
  | "txt"
  | "hwp"
  | "md"
  | "xls"
  | "doc"
  | "ppt"
  | "other";

type Outcome = "ok" | "empty" | "fail";

type ProbeRow = {
  drive: string;
  path: string;
  fullPath: string;
  ext: Ext;
  sizeBytes: number;
  outcome: Outcome;
  chars: number;
  ms: number;
  error?: string;
  preview?: string;
  luckyHit?: boolean;
};

const BACKUP_RE = /(old|backup|백업|보관|archive|이전)/i;
const DOC_EXTS = new Set([
  "pdf",
  "pptx",
  "xlsx",
  "docx",
  "txt",
  "hwp",
  "md",
  "xls",
  "doc",
  "ppt"
]);

/** --limit=200 기준 할당 (합 200) */
const QUOTA: Record<string, number> = {
  pdf: 100,
  pptx: 60,
  xlsx: 17,
  docx: 11,
  txt: 6,
  hwp: 5,
  legacy: 1 // xls|doc|ppt 중 1
};

const CHUNK_CHARS = 1000;
const CORPUS_TARGET = 19_515; // 백업 제외 후 사용자 제시

function parseArgs(argv: string[]) {
  let limit = 200;
  for (const a of argv) {
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { limit };
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

function extOf(path: string): Ext {
  const e = extname(path).slice(1).toLowerCase();
  if (DOC_EXTS.has(e)) return e as Ext;
  return "other";
}

function resolveFullPath(drive: string, relativePath: string): string[] {
  const rel = relativePath.replace(/\//g, "\\");
  const letter = `${drive}:\\${rel}`;
  const uncRoots: Record<string, string> = {
    T: "\\\\aiw\\work",
    P: "\\\\aiw\\partners"
  };
  const unc = uncRoots[drive.toUpperCase()];
  const candidates = [letter];
  if (unc) candidates.push(`${unc}\\${rel}`);
  return candidates;
}

function pickExistingPath(drive: string, relativePath: string): string | null {
  for (const p of resolveFullPath(drive, relativePath)) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* */
    }
  }
  return null;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? (a[mid - 1]! + a[mid]!) / 2 : a[mid]!;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractPptx(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const parts: string[] = [];
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // 노트·도형도 a:t 로 들어옴
  const extra = Object.keys(zip.files).filter(
    (n) =>
      /^ppt\/slides\/_rels\//i.test(n) === false &&
      (/^ppt\/diagrams\//i.test(n) ||
        /^ppt\/charts\//i.test(n) ||
        /notesSlide\d+\.xml$/i.test(n))
  );
  for (const name of [...names, ...extra]) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
      const t = (m[1] ?? "").trim();
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    // 수식 대신 표시값
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      parts.push(`# ${name}`);
      parts.push(csv);
    }
  }
  return parts.join("\n");
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: buf });
  return res.value ?? "";
}

async function extractTxt(buf: Buffer): Promise<string> {
  return buf.toString("utf8");
}

async function extractHwp(_buf: Buffer): Promise<string> {
  // Node 공개 파서 신뢰도가 낮아 이번 조사에서는 미지원으로 기록
  throw new Error("hwp_unsupported");
}

async function extractLegacy(
  ext: Ext,
  buf: Buffer
): Promise<string> {
  if (ext === "xls") {
    return extractXlsx(buf);
  }
  throw new Error(`${ext}_unsupported`);
}

async function extractText(ext: Ext, buf: Buffer): Promise<string> {
  switch (ext) {
    case "pdf":
      return extractPdf(buf);
    case "pptx":
      return extractPptx(buf);
    case "xlsx":
      return extractXlsx(buf);
    case "docx":
      return extractDocx(buf);
    case "txt":
    case "md":
      return extractTxt(buf);
    case "hwp":
      return extractHwp(buf);
    case "xls":
    case "doc":
    case "ppt":
      return extractLegacy(ext, buf);
    default:
      throw new Error(`unsupported_ext_${ext}`);
  }
}

type NasRow = { drive: string; path: string; size_bytes: number | null };

async function fetchPool(
  admin: SupabaseClient,
  ext: string,
  want: number
): Promise<NasRow[]> {
  // 여유분 확보 후 로컬에서 셔플·존재 확인
  const take = Math.min(want * 8, 2000);
  let q = admin
    .from("nas_directory")
    .select("drive, path, size_bytes")
    .eq("type", "file")
    .ilike("path", `%.${ext}`)
    .not("path", "ilike", "%backup%")
    .not("path", "ilike", "%백업%")
    .not("path", "ilike", "%보관%")
    .not("path", "ilike", "%archive%")
    .not("path", "ilike", "%/old/%")
    .not("path", "ilike", "%\\old\\%")
    .not("path", "ilike", "%이전%")
    .limit(take);

  // supabase-js 필터가 약하므로 가져온 뒤 정규식으로 재필터
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as NasRow[]).filter(
    (r) => typeof r.path === "string" && !BACKUP_RE.test(r.path)
  );
  shuffleInPlace(rows);
  return rows;
}

async function buildSample(
  admin: SupabaseClient,
  limit: number
): Promise<Array<NasRow & { ext: Ext; fullPath: string }>> {
  const scale = limit / 200;
  const quotas: Array<{ ext: Ext | "legacy"; n: number }> = [
    { ext: "pdf", n: Math.round(QUOTA.pdf * scale) },
    { ext: "pptx", n: Math.round(QUOTA.pptx * scale) },
    { ext: "xlsx", n: Math.round(QUOTA.xlsx * scale) },
    { ext: "docx", n: Math.round(QUOTA.docx * scale) },
    { ext: "txt", n: Math.round(QUOTA.txt * scale) },
    { ext: "hwp", n: Math.max(1, Math.round(QUOTA.hwp * scale)) },
    { ext: "legacy", n: Math.max(1, Math.round(QUOTA.legacy * scale)) }
  ];
  // 합이 limit 이 되게 보정
  let sum = quotas.reduce((s, q) => s + q.n, 0);
  while (sum > limit) {
    const q = quotas.find((x) => x.n > 1);
    if (!q) break;
    q.n -= 1;
    sum -= 1;
  }
  while (sum < limit) {
    quotas[0]!.n += 1;
    sum += 1;
  }

  const out: Array<NasRow & { ext: Ext; fullPath: string }> = [];
  const used = new Set<string>();

  async function takeExt(ext: Ext, need: number) {
    const pool = await fetchPool(admin, ext, need);
    for (const row of pool) {
      if (out.length >= limit) break;
      if (need <= 0) break;
      const key = `${row.drive}:${row.path}`;
      if (used.has(key)) continue;
      const full = pickExistingPath(row.drive, row.path);
      if (!full) continue;
      // 초대형(>200MB)은 속도 조사에 왜곡 — 표본에서 건너뛰고 다음 후보
      const size = Number(row.size_bytes) || 0;
      if (size > 200 * 1024 * 1024) continue;
      used.add(key);
      out.push({ ...row, ext, fullPath: full });
      need -= 1;
    }
    return need;
  }

  for (const q of quotas) {
    if (q.ext === "legacy") {
      let need = q.n;
      for (const e of ["xls", "doc", "ppt"] as Ext[]) {
        if (need <= 0) break;
        need = await takeExt(e, need);
      }
      continue;
    }
    await takeExt(q.ext, q.n);
  }

  return out.slice(0, limit);
}

function containsLucky(text: string): boolean {
  return /lucky\s*picker|lucky\s*flip|럭키\s*피커|럭키피커/i.test(text);
}

async function probeOne(
  row: NasRow & { ext: Ext; fullPath: string }
): Promise<ProbeRow> {
  const base: ProbeRow = {
    drive: row.drive,
    path: row.path,
    fullPath: row.fullPath,
    ext: row.ext,
    sizeBytes: Number(row.size_bytes) || 0,
    outcome: "fail",
    chars: 0,
    ms: 0
  };
  const t0 = Date.now();
  try {
    const st = statSync(row.fullPath);
    base.sizeBytes = st.size;
    const buf = readFileSync(row.fullPath);
    const text = await extractText(row.ext, buf);
    const cleaned = text.replace(/\u0000/g, "").trim();
    base.chars = cleaned.length;
    base.ms = Date.now() - t0;
    base.preview = cleaned.slice(0, 300);
    base.luckyHit = containsLucky(cleaned);
    if (cleaned.length >= 100) base.outcome = "ok";
    else base.outcome = "empty";
  } catch (e) {
    base.ms = Date.now() - t0;
    base.error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    base.outcome = "fail";
  }
  return base;
}

async function probeLuckyTargets(admin: SupabaseClient): Promise<{
  tried: number;
  hits: Array<{ path: string; ext: string; snippet: string }>;
  misses: string[];
}> {
  const { data, error } = await admin
    .from("nas_directory")
    .select("drive, path, size_bytes")
    .eq("type", "file")
    .or(
      "path.ilike.%Lucky Picker%,path.ilike.%Lucky_Flip%,path.ilike.%lucky flip%,path.ilike.%Lucky%Picker%"
    )
    .limit(20);
  if (error) throw error;
  const hits: Array<{ path: string; ext: string; snippet: string }> = [];
  const misses: string[] = [];
  let tried = 0;
  for (const row of (data ?? []) as NasRow[]) {
    if (BACKUP_RE.test(row.path)) continue;
    const full = pickExistingPath(row.drive, row.path);
    if (!full) {
      misses.push(`${row.drive}:${row.path} (missing)`);
      continue;
    }
    const size = Number(row.size_bytes) || 0;
    if (size > 80 * 1024 * 1024) {
      misses.push(`${row.path} (too large ${size})`);
      continue;
    }
    const ext = extOf(row.path);
    if (ext === "other") continue;
    tried += 1;
    try {
      const buf = readFileSync(full);
      const text = await extractText(ext, buf);
      if (containsLucky(text) || /lucky/i.test(row.path)) {
        const idx = text.toLowerCase().search(/lucky|럭키/);
        const snippet =
          idx >= 0
            ? text.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, " ")
            : text.slice(0, 120).replace(/\s+/g, " ");
        hits.push({ path: `${row.drive}:\\${row.path}`, ext, snippet });
      } else {
        misses.push(row.path);
      }
    } catch (e) {
      misses.push(
        `${row.path} (${e instanceof Error ? e.message : String(e)})`
      );
    }
  }
  return { tried, hits, misses: misses.slice(0, 20) };
}

function summarize(rows: ProbeRow[]) {
  const byExt: Record<
    string,
    { ok: number; empty: number; fail: number; ms: number[]; chars: number[] }
  > = {};
  for (const r of rows) {
    const b = (byExt[r.ext] ??= { ok: 0, empty: 0, fail: 0, ms: [], chars: [] });
    b[r.outcome] += 1;
    b.ms.push(r.ms);
    if (r.outcome === "ok") b.chars.push(r.chars);
  }

  const okChars = rows.filter((r) => r.outcome === "ok").map((r) => r.chars);
  const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const over100k = okChars.filter((c) => c >= 100_000).length;
  const totalOkChars = okChars.reduce((s, n) => s + n, 0);
  const estChunksSample = okChars.reduce(
    (s, n) => s + Math.max(1, Math.ceil(n / CHUNK_CHARS)),
    0
  );

  return {
    byExt,
    okChars,
    slowest,
    over100k,
    totalOkChars,
    estChunksSample,
    okCount: okChars.length
  };
}

function scaleEstimate(summary: ReturnType<typeof summarize>, sampleN: number) {
  const okRate = summary.okCount / Math.max(1, sampleN);
  const avgMsAll =
    mean(
      Object.values(summary.byExt).flatMap((b) => b.ms)
    ) / 1000;
  const avgCharsOk = mean(summary.okChars);
  const avgChunksOk =
    summary.okCount > 0 ? summary.estChunksSample / summary.okCount : 0;

  const expectedOk = CORPUS_TARGET * okRate;
  const extractHours = (CORPUS_TARGET * avgMsAll) / 3600;
  const chunks = expectedOk * avgChunksOk;
  // text-embedding-3-small ~ $0.02 / 1M tokens ≈ 4 chars/token → $0.02/4M chars
  // 보수: 청크당 ~250 tokens → $0.02 * chunks * 250 / 1e6
  const embedUsd = (chunks * 250) / 1_000_000 * 0.02;
  // 본문 저장: ok 파일 평균 문자 * 3 bytes(utf8 한글) + 메타
  const bodyBytes = expectedOk * avgCharsOk * 3;
  const bodyGb = bodyBytes / (1024 * 1024 * 1024);

  return {
    corpus: CORPUS_TARGET,
    sampleN,
    okRate,
    avgMsSec: avgMsAll,
    avgCharsOk,
    avgChunksOk,
    extractHours,
    expectedOk,
    chunks,
    embedUsd,
    bodyGb
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const admin = createAdmin();
  console.log(`probe-nas-text limit=${opts.limit}`);

  const mapped = ["T", "P"].filter((d) => existsSync(`${d}:\\`));
  console.log(`mapped drives: ${mapped.join(",") || "(none)"}`);
  if (mapped.length === 0) {
    console.error(
      "T:/P: 없음. 회사 PC 대화형 세션에서 실행하세요 (schtasks /IT)."
    );
    process.exit(1);
  }

  console.log("sampling…");
  const sample = await buildSample(admin, opts.limit);
  console.log(`sample ready: ${sample.length}`);
  const byExtCount: Record<string, number> = {};
  for (const s of sample) {
    byExtCount[s.ext] = (byExtCount[s.ext] ?? 0) + 1;
  }
  console.log("sample mix:", byExtCount);

  const rows: ProbeRow[] = [];
  for (let i = 0; i < sample.length; i++) {
    const s = sample[i]!;
    process.stdout.write(
      `[${i + 1}/${sample.length}] ${s.ext} ${s.path.slice(-60)} … `
    );
    const r = await probeOne(s);
    rows.push(r);
    console.log(`${r.outcome} chars=${r.chars} ${r.ms}ms`);
  }

  console.log("\nLucky Picker targets…");
  const lucky = await probeLuckyTargets(admin);
  console.log(
    `lucky tried=${lucky.tried} hits=${lucky.hits.length} misses=${lucky.misses.length}`
  );
  for (const h of lucky.hits) {
    console.log(`  HIT ${h.ext}: ${h.path}`);
    console.log(`    ${h.snippet}`);
  }

  const summary = summarize(rows);
  const estimate = scaleEstimate(summary, rows.length);

  const okSamples = rows
    .filter((r) => r.outcome === "ok" && r.preview)
    .slice(0, 5)
    .map((r) => ({
      ext: r.ext,
      path: `${r.drive}:\\${r.path}`,
      chars: r.chars,
      preview: r.preview
    }));

  const report = {
    generated_at: new Date().toISOString(),
    limit: opts.limit,
    sample_count: rows.length,
    sample_mix: byExtCount,
    by_ext: Object.fromEntries(
      Object.entries(summary.byExt).map(([ext, b]) => {
        const total = b.ok + b.empty + b.fail;
        return [
          ext,
          {
            ok: b.ok,
            empty: b.empty,
            fail: b.fail,
            total,
            ok_pct: total ? Math.round((1000 * b.ok) / total) / 10 : 0,
            empty_pct: total ? Math.round((1000 * b.empty) / total) / 10 : 0,
            fail_pct: total ? Math.round((1000 * b.fail) / total) / 10 : 0,
            avg_ms: Math.round(mean(b.ms)),
            avg_chars_ok: Math.round(mean(b.chars)),
            median_chars_ok: Math.round(median(b.chars)),
            max_chars_ok: b.chars.length ? Math.max(...b.chars) : 0
          }
        ];
      })
    ),
    chars: {
      avg: Math.round(mean(summary.okChars)),
      median: Math.round(median(summary.okChars)),
      max: summary.okChars.length ? Math.max(...summary.okChars) : 0,
      over_100k: summary.over100k,
      sample_chunks_1000: summary.estChunksSample
    },
    slowest: summary.slowest.map((r) => ({
      ms: r.ms,
      size_bytes: r.sizeBytes,
      ext: r.ext,
      outcome: r.outcome,
      path: `${r.drive}:\\${r.path}`
    })),
    previews: okSamples,
    lucky,
    estimate,
    rows
  };

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const out = resolve(process.cwd(), "tmp", "probe-nas-text.json");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nJSON: ${out}`);

  console.log("\n=== by ext ===");
  for (const [ext, b] of Object.entries(report.by_ext)) {
    const x = b as {
      ok: number;
      empty: number;
      fail: number;
      ok_pct: number;
      empty_pct: number;
      fail_pct: number;
      avg_ms: number;
    };
    console.log(
      `${ext}: ok ${x.ok} (${x.ok_pct}%) empty ${x.empty} (${x.empty_pct}%) fail ${x.fail} (${x.fail_pct}%) avg ${x.avg_ms}ms`
    );
  }
  console.log("\n=== estimate full corpus ===");
  console.log(JSON.stringify(estimate, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
