/**
 * 홈 자동 피드 확인 + 스크린샷
 * npx tsx scripts/verify-home-auto-feed.ts
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
const OUT = resolve(process.cwd(), "scripts/out-home-auto-feed");

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
  const report: Record<string, unknown> = {};

  const hubUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const hubService = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;
  const hubAnon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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

  const { data: colCheck, error: colErr } = await siteAdmin
    .from("works")
    .select("id, home_pinned, home_pin_sort, home_layout")
    .limit(1);
  report.homeColumns = { ok: !colErr, error: colErr?.message ?? null, sample: colCheck?.[0] ?? null };

  const { count: workCount } = await siteAdmin
    .from("works")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  const { count: insightCount } = await siteAdmin
    .from("insights")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  report.publishedCounts = { works: workCount, insights: insightCount };

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, hubUrl);

  await page.goto(`${HUB_URL}/website/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1500);

  const bodyText = await page.locator(".ha").innerText().catch(() => page.locator("body").innerText());
  report.hasSave = /저장/.test(bodyText);
  report.hasPublish = /게시/.test(bodyText);
  report.hasMoreLabel = bodyText.includes("더보기 · 5개");
  report.hasPinHint = bodyText.includes("핀을 꽂으면 새 글이 올라와도 자리를 지킵니다");
  report.cells = await page.locator(".ha-cell").count();
  report.bigLabels = await page.locator(".ha-chip", { hasText: "큰 칸" }).count();
  report.smallLabels = await page.locator(".ha-chip", { hasText: /^작은 칸$/ }).count();
  await page.screenshot({ path: resolve(OUT, "01-home-admin.png"), fullPage: true });

  const firstCell = page.locator(".ha-cell").first();
  await firstCell.hover();
  await page.waitForTimeout(400);
  report.hoverSwap = (await page.getByRole("button", { name: /칸으로/ }).count()) > 0;
  await page.screenshot({ path: resolve(OUT, "02-hover-layout.png"), fullPage: false });

  const pinBtn = firstCell.locator(".ha-cell__pin button").first();
  if (await pinBtn.count()) {
    await pinBtn.click();
    await page.waitForTimeout(300);
  }
  report.pinnedBorder = (await page.locator(".ha-cell.is-pinned").count()) > 0;
  report.saveEmphasized = await page.locator("button.ha-btn.is-primary", { hasText: "저장" }).count();
  await page.screenshot({ path: resolve(OUT, "03-pinned.png"), fullPage: false });

  if (await page.getByRole("button", { name: "더보기 · 5개" }).count()) {
    await page.getByRole("button", { name: "더보기 · 5개" }).click();
    await page.waitForTimeout(400);
    report.cellsAfterMore = await page.locator(".ha-cell").count();
    await page.screenshot({ path: resolve(OUT, "04-more.png"), fullPage: true });
  } else {
    report.cellsAfterMore = report.cells;
  }

  const saveBtn = page.locator("button.ha-btn", { hasText: "저장" }).first();
  await saveBtn.click();
  await page.waitForTimeout(1200);
  report.unpublishedNotice = (await page.getByText("저장했지만 아직 게시되지 않았습니다").count()) > 0;
  report.publishEmphasized = await page.locator("button.ha-btn.is-primary", { hasText: "게시" }).count();
  await page.screenshot({ path: resolve(OUT, "05-saved.png"), fullPage: false });

  const publishBtn = page.locator("button.ha-btn", { hasText: "게시" }).first();
  await publishBtn.click();
  await page.waitForTimeout(2000);
  report.afterPublishNotice = (await page.getByText("저장했지만 아직 게시되지 않았습니다").count()) > 0;
  await page.screenshot({ path: resolve(OUT, "06-published.png"), fullPage: false });

  const site = await context.newPage();
  await site.goto(`${SITE_URL}/api/home?page=1&limit=10`, { waitUntil: "networkidle", timeout: 60_000 });
  const apiText = await site.locator("body").innerText();
  let api: { items?: Array<{ type?: string; layout?: string }> } = {};
  try {
    api = JSON.parse(apiText) as typeof api;
  } catch {
    api = {};
  }
  report.publicApiCount = api.items?.length ?? 0;
  report.publicApiTypes = (api.items ?? []).map((item) => `${item.type}:${item.layout}`);

  await site.goto(`${SITE_URL}/ko`, { waitUntil: "networkidle", timeout: 120_000 });
  await site.waitForTimeout(2000);
  report.publicWide = await site.locator(".main-grid__item--wide").count();
  report.publicGrid = await site.locator(".main-grid__item--grid").count();
  await site.screenshot({ path: resolve(OUT, "07-public-home.png"), fullPage: true });

  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const ok =
    Boolean(report.hasSave) &&
    Boolean(report.hasPublish) &&
    (report.cells as number) > 0 &&
    Boolean(report.hoverSwap) &&
    Boolean(report.pinnedBorder);

  if (!ok) {
    console.error("VERIFY_FAILED");
    process.exit(1);
  }
  console.log("VERIFY_OK");
  console.log("screenshots:", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
