/**
 * 멤버 역할로 홈페이지 어드민 접근·API·다른 서비스 차단 확인
 * npx tsx scripts/verify-member-website-access.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";
import { canAccessWebsiteAdmin, isWebsiteTesterPathAllowed } from "@/lib/auth/website-tester";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  token_type: string;
  user: unknown;
};

function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

async function createSession(
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
  email: string
): Promise<Session> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session as unknown as Session;
}

async function login(
  context: BrowserContext,
  page: Page,
  session: Session,
  supabaseUrl: string
) {
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const b64url = Buffer.from(JSON.stringify(session))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const packed = `base64-${b64url}`;
  const CHUNK = 3180;
  const cookies =
    packed.length <= CHUNK
      ? [{ name: key, value: packed }]
      : Array.from({ length: Math.ceil(packed.length / CHUNK) }, (_, i) => ({
          name: `${key}.${i}`,
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK)
        }));
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, url: HUB_URL, sameSite: "Lax" as const }))
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function main() {
  const unit = {
    member: canAccessWebsiteAdmin("멤버"),
    middle: canAccessWebsiteAdmin("중간관리자"),
    super: canAccessWebsiteAdmin("슈퍼관리자"),
    tester: canAccessWebsiteAdmin("홈페이지테스터"),
    empty: canAccessWebsiteAdmin(""),
    nullish: canAccessWebsiteAdmin(null),
    testerBlockedSettings: !isWebsiteTesterPathAllowed("/settings"),
    testerBlockedLicenses: !isWebsiteTesterPathAllowed("/licenses"),
    testerAllowedWebsite: isWebsiteTesterPathAllowed("/website/works")
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: members } = await admin
    .from("profiles")
    .select("id, email, role, name")
    .eq("role", "멤버")
    .not("email", "is", null)
    .limit(5);

  const member = (members ?? []).find((row) => typeof row.email === "string" && row.email.includes("@"));
  if (!member?.email) {
    console.log(JSON.stringify({ unit, browser: { skipped: "no member email" } }, null, 2));
    return;
  }

  const session = await createSession(admin, anonKey, supabaseUrl, member.email as string);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  // /website
  await page.goto(`${HUB_URL}/website`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  const websiteUrl = page.url();
  const websiteOk =
    websiteUrl.includes("/website") &&
    !websiteUrl.includes("/hub") &&
    (await page.getByText("홈페이지").first().isVisible().catch(() => false));

  // works list + open editor
  await page.goto(`${HUB_URL}/website/works`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  const worksOk = page.url().includes("/website/works");
  const newWorkVisible = await page.getByRole("button", { name: /새 워크|＋|추가/ }).first().isVisible().catch(() => false);
  const workLink = page.locator('a[href*="/website/works/"]').first();
  let workEditorOk = false;
  let publishBtnVisible = false;
  if ((await workLink.count()) > 0) {
    await workLink.click();
    await page.waitForTimeout(3000);
    workEditorOk = page.url().includes("/website/works/");
    publishBtnVisible = await page.getByRole("button", { name: /^공개$|공개하기/ }).first().isVisible().catch(() => false);
  }

  // insights
  await page.goto(`${HUB_URL}/website/insights`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  const insightsOk = page.url().includes("/website/insights");
  const newInsightVisible = await page
    .getByRole("button", { name: /새 글|＋/ })
    .first()
    .isVisible()
    .catch(() => false);

  // home
  await page.goto(`${HUB_URL}/website/home`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  const homeOk = page.url().includes("/website/home");

  // stats
  await page.goto(`${HUB_URL}/website/stats/summary`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(2000);
  const statsOk = page.url().includes("/website/stats");

  // API proxy as member
  const apiWorks = await page.evaluate(async () => {
    const res = await fetch("/api/website/works?limit=1", { credentials: "include" });
    return { status: res.status, ok: res.ok };
  });

  // other services still reachable for 멤버 (not tester)
  await page.goto(`${HUB_URL}/hub`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2000);
  const hubOk = page.url().includes("/hub");
  const settingsLink = await page.locator('a[href="/settings"]').first().isVisible().catch(() => false);

  await page.goto(`${HUB_URL}/settings`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  const settingsOk = page.url().includes("/settings");

  await browser.close();

  const report = {
    unit,
    member: { email: member.email, role: member.role },
    browser: {
      websiteOk,
      websiteUrl,
      worksOk,
      newWorkVisible,
      workEditorOk,
      publishBtnVisible,
      insightsOk,
      newInsightVisible,
      homeOk,
      statsOk,
      apiWorks,
      hubOk,
      settingsLink,
      settingsOk
    }
  };
  console.log(JSON.stringify(report, null, 2));

  const fail =
    !unit.member ||
    !unit.middle ||
    unit.empty ||
    !websiteOk ||
    !worksOk ||
    !insightsOk ||
    !homeOk ||
    !apiWorks.ok ||
    !hubOk ||
    !settingsOk;
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
