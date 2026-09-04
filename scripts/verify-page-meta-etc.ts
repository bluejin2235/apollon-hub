/**
 * 기타 page_meta 화면·저장·공개 meta 확인
 * npx tsx scripts/verify-page-meta-etc.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-page-meta");
const MARK = `메타검증${Date.now().toString().slice(-6)}`;

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

async function pickAdminEmail(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("profiles").select("email").eq("role", "슈퍼관리자").limit(1);
  const email = (data ?? [])[0]?.email as string | undefined;
  if (!email) throw new Error("no super admin");
  return email;
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
  await context.addCookies([{ name: key, value: packed, url: HUB_URL, sameSite: "Lax" as const }]);
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const hubUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const hubService =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;
  const hubAnon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const hubAuth = createClient(hubUrl, hubService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = await pickAdminEmail(hubAuth);
  const session = await createSession(hubAuth, hubAnon, hubUrl, email);

  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(context, page, session, hubUrl);

  await page.goto(`${HUB_URL}/website/etc`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector(".etc .tabs button", { timeout: 90_000 });
  const tabLabels = await page.locator(".etc .tabs button").allTextContents();
  await page.screenshot({ path: resolve(OUT, "etc-tabs.png"), fullPage: false });

  await page.getByRole("button", { name: /^About$/ }).click();
  await page.waitForTimeout(400);

  const titleKo = page.locator(".etc .box-inner .f").first().locator("input").first();
  const titleEn = page.locator(".etc .box-inner .f").first().locator("input").nth(1);
  await titleKo.fill(`회사 소개 | ${MARK}`);
  await titleEn.fill(`About | ${MARK}`);

  const descKo = page.locator(".etc .box-inner .f").nth(1).locator("textarea").first();
  const descEn = page.locator(".etc .box-inner .f").nth(1).locator("textarea").nth(1);
  await descKo.fill(`${MARK} 건축과 디지털을 하나로 엮어 디지털 랜드마크를 만듭니다.`);
  await descEn.fill(`${MARK} We weave architecture and digital into landmarks.`);

  await page.locator(".etc .grp").first().getByRole("button", { name: "부분 저장" }).click();
  await page.waitForTimeout(2000);

  const { data: aboutRow } = await siteAdmin
    .from("page_meta")
    .select("title, search_description")
    .eq("key", "about")
    .maybeSingle();

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".etc .tabs button", { timeout: 60_000 });
  await page.getByRole("button", { name: /^About$/ }).click();
  await page.waitForTimeout(400);
  const titleAfter = await page
    .locator(".etc .box-inner .f")
    .first()
    .locator("input")
    .first()
    .inputValue();

  await page.getByRole("button", { name: /^Privacy$/ }).click();
  await page.waitForTimeout(400);
  const pill = await page.locator(".etc .inherit").count();
  await page.screenshot({ path: resolve(OUT, "etc-privacy-pill.png"), fullPage: false });

  const aboutRes = await page.request.get(`${SITE_URL}/about`);
  const html = await aboutRes.text();
  const metaMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1] ??
    "";

  const report = {
    tabCount: tabLabels.length,
    tabLabels: tabLabels.map((t) => t.trim()),
    dbTitle: aboutRow?.title,
    dbDesc: aboutRow?.search_description,
    titleAfterReload: titleAfter,
    privacyInheritPills: pill,
    aboutMetaDescription: metaMatch,
    aboutHasMark: metaMatch.includes(MARK) || html.includes(MARK),
    mark: MARK
  };
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
