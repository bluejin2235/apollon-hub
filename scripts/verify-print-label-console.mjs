/**
 * QR 라벨 generateQrLabelImage 콘솔 로그 검증 (실제 인쇄 없음)
 * 실행: node scripts/verify-print-label-console.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const BASE_URL = process.env.PRINT_LABEL_TEST_URL ?? "http://localhost:3000";

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

const env = loadEnvLocal();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SECRET_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function projectRefFromUrl(url) {
  return new URL(url).hostname.split(".")[0];
}

async function pickSupplyAndUser() {
  const { data: supplies, error: sErr } = await admin
    .from("supplies")
    .select("id, code, name, manager_id")
    .order("created_at", { ascending: false })
    .limit(20);

  if (sErr) throw new Error(`supplies query failed: ${sErr.message}`);
  if (!supplies?.length) throw new Error("No supplies found");

  const { data: managers, error: mErr } = await admin
    .from("profiles")
    .select("id, email, role")
    .in("role", ["슈퍼관리자", "중간관리자"])
    .limit(5);

  if (mErr) throw new Error(`profiles query failed: ${mErr.message}`);

  const superAdmin = managers?.find((p) => p.role === "슈퍼관리자") ?? managers?.[0];
  if (!superAdmin) throw new Error("No manager profile for login");

  const supply =
    supplies.find((s) => s.manager_id === superAdmin.id) ??
    supplies.find((s) => s.manager_id) ??
    supplies[0];

  return { supply, userId: superAdmin.id, email: superAdmin.email };
}

async function createBrowserSession(email) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no token"}`);
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) {
    throw new Error(`verifyOtp failed: ${error?.message ?? "no session"}`);
  }
  return data.session;
}

async function main() {
  const { supply, userId, email } = await pickSupplyAndUser();
  const session = await createBrowserSession(email);
  const projectRef = projectRefFromUrl(supabaseUrl);
  const storageKey = `sb-${projectRef}-auth-token`;

  const sessionPayload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user
  };

  console.log(`Supply: ${supply.code} (${supply.id})`);
  console.log(`User: ${userId}`);
  console.log(`URL: ${BASE_URL}/supplies/${supply.id}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const printLogs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[print-label]") && text.includes("generateQrLabelImage")) {
      printLogs.push({ type: msg.type(), text });
    }
  });

  await page.route("**/rest/v1/print_jobs**", (route) => {
    if (route.request().method() === "POST") {
      console.log("(print_jobs INSERT blocked — no actual print)");
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: storageKey, value: sessionPayload }
  );

  const detailUrl = `${BASE_URL}/supplies/${supply.id}`;
  await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 120_000 });

  const button = page.getByRole("button", { name: /QR 라벨 출력/ });
  await button.waitFor({ state: "visible", timeout: 60_000 });
  await button.click();

  await page.waitForTimeout(3000);

  await browser.close();

  if (printLogs.length === 0) {
    console.error("FAIL: generateQrLabelImage log not found in console");
    process.exit(1);
  }

  const logText = printLogs.map((l) => l.text).join("\n");
  console.log("\n--- Captured console log ---");
  console.log(logText);

  const widthOk = /labelWidth['":\s]*200/.test(logText) || logText.includes('"labelWidth": 200');
  const heightOk = /labelHeight['":\s]*96/.test(logText) || logText.includes('"labelHeight": 96');

  if (widthOk && heightOk) {
    console.log("\nPASS: labelWidth=200, labelHeight=96");
    process.exit(0);
  }

  console.error("\nFAIL: expected labelWidth=200 and labelHeight=96");
  console.error({ widthOk, heightOk });
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
