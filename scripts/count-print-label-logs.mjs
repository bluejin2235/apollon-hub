import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const SUPPLY_ID = "3fd66ae2-bb62-42c0-8bbc-8d0a1efa5a12";
const DETAIL_URL = `http://localhost:3000/supplies/${SUPPLY_ID}`;
const WAIT_MS = 45_000;

const TARGETS = [
  "버튼 클릭 → generating",
  "requestPrint 호출",
  "requestPrint insert 성공",
  "requestPrint insert 실패",
  "라벨 이미지 생성 완료 → printing",
  "job 상태 처리"
];

function loadEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

function matchStep(entry, target) {
  return entry.raw.includes(`[print-label] ${target}`);
}

const env = loadEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: profile } = await admin
  .from("profiles")
  .select("email")
  .eq("role", "슈퍼관리자")
  .limit(1)
  .maybeSingle();
if (!profile?.email) throw new Error("No super admin profile");

const { data: linkData } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: profile.email
});
const { data: sessData } = await anon.auth.verifyOtp({
  token_hash: linkData.properties.hashed_token,
  type: "email"
});
if (!sessData.session) throw new Error("No session");

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const storageKey = `sb-${ref}-auth-token`;
const sessionPayload = {
  access_token: sessData.session.access_token,
  refresh_token: sessData.session.refresh_token,
  expires_at: sessData.session.expires_at,
  expires_in: sessData.session.expires_in,
  token_type: sessData.session.token_type,
  user: sessData.session.user
};

const entries = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (msg) => {
  const text = msg.text();
  if (!text.includes("[print-label]")) return;
  entries.push({
    ts: new Date().toISOString(),
    raw: text
  });
});

await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.evaluate(
  ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
  { key: storageKey, value: sessionPayload }
);

console.log("URL:", DETAIL_URL);
await page.goto(DETAIL_URL, { waitUntil: "networkidle", timeout: 120_000 });

const clickAt = new Date().toISOString();
const button = page.getByRole("button", { name: /QR 라벨 출력|인쇄 실패 — 다시 시도/ });
await button.waitFor({ state: "visible", timeout: 60_000 });
await button.click();
console.log("CLICK_AT", clickAt);

await page.waitForTimeout(WAIT_MS);
await browser.close();

const afterClick = entries.filter((e) => e.ts >= clickAt);

console.log("\n=== LOG COUNTS (after click) ===");
for (const target of TARGETS) {
  const hits = afterClick.filter((e) => matchStep(e, target));
  console.log(`\n## ${target} — count: ${hits.length}`);
  for (const h of hits) {
    console.log(`  ${h.ts}  ${h.raw}`);
  }
}

console.log("\n=== SUMMARY ===");
for (const target of TARGETS) {
  const hits = afterClick.filter((e) => matchStep(e, target));
  console.log(`${target}: ${hits.length}`);
}

console.log("\n=== ALL [print-label] ENTRIES (after click) ===");
for (const e of afterClick) {
  console.log(`${e.ts}  ${e.raw}`);
}
