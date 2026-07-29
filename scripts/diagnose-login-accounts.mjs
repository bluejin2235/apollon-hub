/**
 * 로그인 계정 진단: auth.users 와 profiles 매칭 점검
 *
 * 실행: node scripts/diagnose-login-accounts.mjs
 * (프로젝트 루트의 .env.local 을 읽습니다. SUPABASE_SECRET_KEY 필요 — service role)
 *
 * 출력:
 *   1) auth.users ↔ profiles 전체 매칭 (email 기준 조인 + id 일치 여부)
 *   2) profiles 는 있는데 auth.users 없는 경우
 *   3) auth.users 는 있는데 profiles 없는 경우
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

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

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 .env.local 에 필요합니다 (service role).");
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function norm(email) {
  return (email ?? "").trim().toLowerCase();
}

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 1000;
  // 페이지네이션
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }
  return all;
}

const authUsers = await listAllAuthUsers();
const { data: profiles, error: pErr } = await admin
  .from("profiles")
  .select("id, email, name, status");
if (pErr) {
  console.error("profiles 조회 실패:", pErr.message, pErr);
  process.exit(1);
}

const profileByEmail = new Map();
for (const p of profiles ?? []) {
  profileByEmail.set(norm(p.email), p);
}
const authByEmail = new Map();
for (const u of authUsers) {
  authByEmail.set(norm(u.email), u);
}

console.log("\n========== 1) auth.users ↔ profiles 전체 매칭 (email 기준) ==========");
console.log(`auth.users: ${authUsers.length}명 | profiles: ${profiles?.length ?? 0}행\n`);
const rows1 = authUsers
  .slice()
  .sort((a, b) => norm(a.email).localeCompare(norm(b.email)))
  .map((u) => {
    const p = profileByEmail.get(norm(u.email)) ?? null;
    let match;
    if (!p) match = "프로필 없음";
    else if (u.id === p.id) match = "정상";
    else match = "ID 불일치";
    return {
      auth_id: u.id,
      auth_email: u.email,
      profile_id: p?.id ?? null,
      profile_email: p?.email ?? null,
      name: p?.name ?? null,
      status: p?.status ?? null,
      match_status: match
    };
  });
console.table(rows1);

console.log("\n========== 2) profiles 는 있는데 auth.users 없는 경우 ==========");
const rows2 = (profiles ?? [])
  .filter((p) => !authByEmail.has(norm(p.email)))
  .map((p) => ({ id: p.id, email: p.email, name: p.name, status: p.status }));
if (rows2.length === 0) console.log("(없음)");
else console.table(rows2);

console.log("\n========== 3) auth.users 는 있는데 profiles 없는 경우 ==========");
const rows3 = authUsers
  .filter((u) => !profileByEmail.has(norm(u.email)))
  .map((u) => ({ id: u.id, email: u.email }));
if (rows3.length === 0) console.log("(없음)");
else console.table(rows3);

const mismatched = rows1.filter((r) => r.match_status === "ID 불일치");
console.log("\n========== 요약 ==========");
console.log(`정상: ${rows1.filter((r) => r.match_status === "정상").length}`);
console.log(`ID 불일치: ${mismatched.length}`);
console.log(`프로필 없음(auth만 존재): ${rows3.length}`);
console.log(`auth 없음(profiles만 존재): ${rows2.length}`);
if (mismatched.length) {
  console.log("\nID 불일치 상세:");
  console.table(mismatched);
}
console.log("\n완료.\n");
