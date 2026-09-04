/**
 * 홈 게시 즉시 갱신 · 더보기 5개
 * npx tsx scripts/verify-home-revalidate.ts
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-home-revalidate");

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

type HomeApi = {
  items?: Array<{ type?: string; layout?: string; work?: { id: string; title?: { ko?: string } }; insight?: { id: string; title?: { ko?: string } } }>;
  total?: number;
  limit?: number;
  hasMore?: boolean;
};

function feedFirstTitle(feed: HomeApi) {
  const item = feed.items?.[0];
  if (!item) return "";
  if (item.type === "work") return item.work?.title?.ko ?? item.work?.id ?? "";
  return item.insight?.title?.ko ?? item.insight?.id ?? "";
}

async function fetchHomeApi(page: Page, query: string) {
  const res = await page.goto(`${SITE_URL}/api/home?${query}`, {
    waitUntil: "networkidle",
    timeout: 60_000
  });
  const text = await res?.text();
  return JSON.parse(text ?? "{}") as HomeApi;
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

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, hubUrl);

  const beforeApi = await fetchHomeApi(page, "page=1&limit=10");
  report.beforeTitle = feedFirstTitle(beforeApi);
  report.initialLimit = 10;
  report.initialCount = beforeApi.items?.length ?? 0;
  report.total = beforeApi.total ?? 0;
  report.hasMoreAfter10 = beforeApi.hasMore;

  const more5 = await fetchHomeApi(page, "page=3&limit=5");
  report.more5Limit = more5.limit;
  report.more5Count = more5.items?.length ?? 0;

  await page.goto(`${HUB_URL}/website/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);

  const cells = page.locator(".ha-cell");
  const cellCount = await cells.count();
  report.adminCells = cellCount;

  const first = cells.first();
  const adminFirstTitle = ((await first.locator(".ha-cell__title").innerText()) || "").trim();
  await first.hover();
  const toSmall = first.getByRole("button", { name: "작은 칸으로" });
  if (await toSmall.count()) {
    await toSmall.click();
    await page.waitForTimeout(200);
  }
  const last = cells.nth(cellCount - 1);
  await last.locator(".ha-cell__pin button").click();
  await page.waitForTimeout(300);
  await page.locator("button.ha-btn", { hasText: "저장" }).first().click();
  await page.waitForTimeout(1800);
  await page.locator("button.ha-btn", { hasText: "게시" }).first().click();
  await page.waitForTimeout(2000);
  report.toggledTitle = adminFirstTitle;
  report.beforeLayout = beforeApi.items?.[0]?.layout ?? null;
  await page.screenshot({ path: resolve(OUT, "01-admin-after-publish.png"), fullPage: false });

  const t0 = Date.now();
  const afterApi = await fetchHomeApi(page, "page=1&limit=10");
  report.apiMs = Date.now() - t0;
  report.afterTitle = feedFirstTitle(afterApi);
  report.afterLayout = afterApi.items?.[0]?.layout ?? null;

  const site = await context.newPage();
  const t1 = Date.now();
  await site.goto(`${SITE_URL}/ko`, { waitUntil: "networkidle", timeout: 120_000 });
  report.pageMs = Date.now() - t1;
  await site.waitForTimeout(800);
  const publicCards = await site.locator(".main-grid__item").count();
  const loadMore = await site.getByRole("button").filter({ hasText: /더보기|more/i }).count();
  report.publicCards = publicCards;
  report.publicLoadMoreVisible = loadMore > 0;
  report.publicFirstClass = await site.locator(".main-grid__item").first().getAttribute("class");
  await site.screenshot({ path: resolve(OUT, "02-public-after-publish.png"), fullPage: true });

  const moreReqs: string[] = [];
  site.on("request", (req) => {
    if (req.url().includes("/api/home")) moreReqs.push(req.url());
  });
  if (loadMore > 0) {
    await site.getByRole("button").filter({ hasText: /더보기|more/i }).first().click();
    await site.waitForTimeout(1500);
    report.cardsAfterMore = await site.locator(".main-grid__item").count();
  }
  report.homeApiRequests = moreReqs;

  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const ok =
    report.beforeLayout === "wide" &&
    report.afterLayout === "grid" &&
    String(report.publicFirstClass ?? "").includes("main-grid__item--grid") &&
    (report.apiMs as number) < 30_000 &&
    (report.pageMs as number) < 30_000;

  if (!ok) {
    console.error("VERIFY_FAILED");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
