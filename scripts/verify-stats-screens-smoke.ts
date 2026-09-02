/**
 * 요약·콘텐츠·검색 세 화면이 도우미 함수를 공용 파일로 옮긴 뒤에도
 * 그대로 열리는지 본다.
 * npx tsx scripts/verify-stats-screens-smoke.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SCREENS = ["summary", "content", "search"] as const;

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

const COUNT_MARKS = `(() => ({
  heading: (document.querySelector("h2.ws-pt") || {}).textContent || "",
  charts: document.querySelectorAll(".ws-chart").length,
  bars: document.querySelectorAll(".recharts-bar-rectangle").length,
  lines: document.querySelectorAll(".recharts-line-curve").length,
  sectors: document.querySelectorAll(".recharts-pie-sector").length,
  dots: document.querySelectorAll(".recharts-symbols").length,
  dashes: (document.body.textContent || "").split("—").length - 1
}))()`;

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  const errors: Record<string, string[]> = {};
  let current = "boot";
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    (errors[current] ??= []).push(msg.text().slice(0, 160));
  });
  page.on("pageerror", (err) => {
    (errors[current] ??= []).push(`pageerror: ${err.message.slice(0, 160)}`);
  });

  const out: Record<string, unknown> = {};
  try {
    await login(context, page, session, supabaseUrl);
    for (const screen of SCREENS) {
      current = screen;
      await page.goto(`${HUB_URL}/website/stats/${screen}`, {
        waitUntil: "domcontentloaded",
        timeout: 180_000,
      });
      await page.locator("h2.ws-pt").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(3500);
      out[screen] = await page.evaluate(COUNT_MARKS);
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== stats screens smoke ===");
  console.log(JSON.stringify({ screens: out, errors }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
