/**
 * 아슐랭 갤러리 진단: Storage(restaurant-images) 목록 + restaurant_images 상위 N행
 *
 * 실행: node scripts/diagnose-restaurant-gallery.mjs
 * (프로젝트 루트의 .env.local 을 읽습니다.)
 *
 * Storage 전체 목록은 service role(SUPABASE_SECRET_KEY)이 있으면 더 안정적입니다.
 * anon만 있으면 Storage RLS에 따라 list 가 실패할 수 있습니다.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const BUCKET = "restaurant-images";

function loadEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const txt = readFileSync(p, "utf8");
  const out = {};
  for (const line of txt.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

async function listStorageRecursive(client, prefix = "", depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) return { error, paths: [] };
  const paths = [];
  for (const item of data ?? []) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    const isFile = item.metadata != null;
    if (isFile) {
      paths.push(rel);
    } else {
      const sub = await listStorageRecursive(client, rel, depth + 1, maxDepth);
      if (sub.error) return sub;
      paths.push(...sub.paths);
    }
  }
  return { error: null, paths };
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !publishable) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 없습니다 (.env.local).");
  process.exit(1);
}

const keyMode = secret ? "SUPABASE_SECRET_KEY (service)" : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon)";
const client = createClient(url, secret || publishable);

console.log("\n========== 1) Supabase Storage:", BUCKET, "==========");
console.log("Client key:", keyMode);
console.log("Project URL:", url);

const listed = await listStorageRecursive(client, "", 0, 5);
if (listed.error) {
  console.error("storage.list error:", listed.error.message, listed.error);
  console.log(
    "→ anon으로 list 가 막혀 있으면 대시보드 Storage → restaurant-images 에서 파일 존재 여부를 확인하거나, .env.local 에 SUPABASE_SECRET_KEY 를 넣고 다시 실행하세요."
  );
} else {
  const paths = listed.paths;
  console.log("파일 개수(재귀 목록):", paths.length);
  console.log("샘플(최대 20개):", paths.slice(0, 20));
}

console.log("\n========== 2) restaurant_images (LIMIT 10) ==========");
const { data: rows, error: qErr, count: totalApprox } = await client
  .from("restaurant_images")
  .select("*", { count: "exact" })
  .limit(10);
if (qErr) {
  console.error("select error:", qErr.message, qErr);
} else {
  console.log("표시 행 수:", rows?.length ?? 0, "| 테이블 전체 count:", totalApprox ?? "(unknown)");
  console.log(JSON.stringify(rows, null, 2));
}

console.log("\n========== 3) 공개 URL 샘플 ==========");
if (rows?.length) {
  const path = rows[0].storage_path;
  const enc = String(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  console.log("첫 행 storage_path:", path);
  console.log("브라우저용 예시:", `${url.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${enc}`);
}

console.log("\n완료.\n");
