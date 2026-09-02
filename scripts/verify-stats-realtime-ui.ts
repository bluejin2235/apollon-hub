/**
 * Realtime UI 실측 — Playwright
 * npx tsx scripts/verify-stats-realtime-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";

function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

async function pickAdminEmail(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("email, role")
    .eq("role", "슈퍼관리자")
    .limit(1);
  const email = (data ?? [])[0]?.email as string | undefined;
  if (!email) throw new Error("no super admin user");
  return email;
}

async function createSession(admin: SupabaseClient, anonKey: string, supabaseUrl: string) {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: await pickAdminEmail(admin),
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function login(
  context: BrowserContext,
  page: Page,
  session: unknown,
  supabaseUrl: string,
) {
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const packed = `base64-${Buffer.from(JSON.stringify(session))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
  const CHUNK = 3180;
  const cookies =
    packed.length <= CHUNK
      ? [{ name: key, value: packed }]
      : Array.from({ length: Math.ceil(packed.length / CHUNK) }, (_, i) => ({
          name: `${key}.${i}`,
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, url: HUB_URL, sameSite: "Lax" as const })),
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(admin, anonKey, supabaseUrl);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const realtimeCalls: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/website/stats/realtime")) realtimeCalls.push(req.url());
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message.slice(0, 160)}`));

  const report: Record<string, unknown> = {};

  try {
    await login(context, page, session, supabaseUrl);

    await page.goto(`${HUB_URL}/website/stats/summary`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator(".ws-live").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3500);

    report.liveTextFirst = (await page.locator(".ws-live span").last().textContent())?.trim();
    report.callsAfterLoad = realtimeCalls.length;

    // 30초 폴링 — 타이머를 31초 기다린다
    await page.waitForTimeout(31_000);
    report.callsAfter31s = realtimeCalls.length;
    report.refetched = realtimeCalls.length >= 2;
    report.liveTextSecond = (await page.locator(".ws-live span").last().textContent())?.trim();

    // 오류여도 화면은 살아 있어야 한다
    report.headingOk = (await page.locator("h2.ws-pt").textContent())?.trim() === "요약";
    report.charts = await page.locator(".ws-chart").count();
    report.consoleErrors = consoleErrors;
  } finally {
    await browser.close();
  }

  console.log("\n=== stats realtime UI verify ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
