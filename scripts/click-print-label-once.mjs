import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const BASE_URL = "http://localhost:3000";

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: managers } = await admin
  .from("profiles")
  .select("id, email, role")
  .in("role", ["슈퍼관리자", "중간관리자"])
  .limit(5);
const superAdmin = managers?.find((p) => p.role === "슈퍼관리자") ?? managers?.[0];
if (!superAdmin) throw new Error("No admin profile");

const { data: supplies } = await admin
  .from("supplies")
  .select("id, code, name, manager_id")
  .order("created_at", { ascending: false })
  .limit(20);
const supply =
  supplies?.find((s) => s.manager_id === superAdmin.id) ?? supplies?.[0];
if (!supply) throw new Error("No supply");

const { data: linkData } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: superAdmin.email
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(
  ({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  },
  { key: storageKey, value: sessionPayload }
);

const detailUrl = `${BASE_URL}/supplies/${supply.id}`;
console.log("URL:", detailUrl, "supply:", supply.code);
await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 120_000 });

const button = page.getByRole("button", { name: /QR 라벨 출력/ });
await button.waitFor({ state: "visible", timeout: 60_000 });
await button.click();
console.log("Clicked QR label button once");
await page.waitForTimeout(40_000);
await browser.close();
