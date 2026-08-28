/**
 * 4단계 이미지 UI — Playwright 실측
 * npx tsx scripts/verify-luna-image-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const QUERIES = [
  "더후 글로벌 론칭 KV 이미지 보여줘",
  "로비 미디어아트 레퍼런스"
];
const OUT_DIR = resolve(process.cwd(), "tmp/luna-image-ui-verify");

function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

type ProfileRow = { id: string; email: string | null; role: string | null };

async function pickLunaUser(admin: SupabaseClient): Promise<ProfileRow> {
  const { data: beta } = await admin
    .from("luna_beta_access")
    .select("profile_id")
    .limit(20);
  const ids = ((beta ?? []) as { profile_id: string }[])
    .map((r) => r.profile_id)
    .filter(Boolean);
  if (ids.length === 0) {
    const { data: supers } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("role", "슈퍼관리자")
      .limit(1);
    const row = (supers ?? [])[0] as ProfileRow | undefined;
    if (row?.email) return row;
    throw new Error("no user");
  }
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, role")
    .in("id", ids)
    .limit(5);
  const hit = ((profiles ?? []) as ProfileRow[]).find((p) => p.email);
  if (!hit?.email) throw new Error("no email");
  return hit;
}

async function createSession(
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
  email: string
) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function askQuestion(page: import("playwright").Page, q: string, slug: string) {
  const newBtn = page.getByRole("button", { name: "새 대화" }).first();
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    await page.waitForTimeout(600);
  }

  const input = page.locator("textarea").last();
  await input.fill(q);
  const t0 = Date.now();
  await page.getByRole("button", { name: "전송" }).click();
  await page.waitForFunction(
    () => /\d+\.\d+초/.test(document.body.innerText),
    { timeout: 180_000 }
  );
  await page.waitForTimeout(1500);
  const wallMs = Date.now() - t0;

  const tabsAll = page.getByRole("button", { name: "전체" }).last();
  const tabsDocs = page.getByRole("button", { name: /문서/ }).last();
  const tabsImages = page.getByRole("button", { name: /이미지/ }).last();
  const scopeNotice = page.getByText(/이미지는/).last();
  const imageSection = page.getByText(/🖼 이미지/).last();
  const gridImg = page.locator('img[alt*="jpg"], img[alt*="png"], img[alt*="KV"]').last();
  const clarifyOpts = page.locator('button:has-text("더후")').count();

  const hasTabs =
    (await tabsAll.isVisible().catch(() => false)) &&
    (await tabsDocs.isVisible().catch(() => false)) &&
    (await tabsImages.isVisible().catch(() => false));
  const hasScope = await scopeNotice.isVisible().catch(() => false);
  const hasImageSection = await imageSection.isVisible().catch(() => false);
  const hasGridImg = await gridImg.isVisible().catch(() => false);
  const clarifyCount = await clarifyOpts;

  const body = await page.locator("body").innerText();
  const imageTabMatch = body.match(/이미지\s+(\d+)/);
  const imageTabCount = imageTabMatch ? Number(imageTabMatch[1]) : null;

  mkdirSync(OUT_DIR, { recursive: true });
  const shot = resolve(OUT_DIR, `${slug}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  return {
    q,
    wallSec: (wallMs / 1000).toFixed(1),
    hasTabs,
    hasScope,
    hasImageSection,
    hasGridImg,
    imageTabCount,
    clarifyCount,
    screenshot: shot,
    snippet: body.slice(-800)
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await pickLunaUser(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: storageKey,
      value: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user
      }
    }
  );
  await page.goto(`${BASE_URL}/luna`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });

  for (const q of QUERIES) {
    const slug = q.includes("더후") ? "01-dehoo-kv" : "02-lobby-media";
    const r = await askQuestion(page, q, slug);
    console.log("\n===", q, "===");
    console.log("wall:", r.wallSec + "s");
    console.log("tabs (전체|문서|이미지):", r.hasTabs);
    console.log("image tab count:", r.imageTabCount);
    console.log("image section (🖼):", r.hasImageSection);
    console.log("grid thumbnail:", r.hasGridImg);
    console.log("scope notice:", r.hasScope);
    console.log("clarify-like buttons:", r.clarifyCount);
    console.log("screenshot:", r.screenshot);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
