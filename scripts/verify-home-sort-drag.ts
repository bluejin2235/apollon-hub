/**
 * 홈 정렬(완공 연도) + 끌어서 핀 확인
 * npx tsx scripts/verify-home-sort-drag.ts
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
const OUT = resolve(process.cwd(), "scripts/out-home-sort-drag");

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  token_type: string;
  user: unknown;
};

type HomeItem = {
  type: "work" | "insight";
  id: string;
  pinned: boolean;
  pin_sort: number | null;
  published_at: string | null;
  content?: { title?: { ko?: string; en?: string }; meta?: string };
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

function sortKey(item: HomeItem, yearById: Map<string, string | null>) {
  if (item.type === "work") {
    const year = (yearById.get(item.id) ?? "").trim();
    if (!/^\d{4}$/.test(year)) return "";
    return `${year}-06-30`;
  }
  return item.published_at ?? "";
}

function expectedUnpinnedOrder(items: HomeItem[], yearById: Map<string, string | null>) {
  return [...items]
    .filter((item) => !item.pinned)
    .sort((a, b) => {
      const ta = sortKey(a, yearById);
      const tb = sortKey(b, yearById);
      if (!ta && !tb) return a.id.localeCompare(b.id);
      if (!ta) return 1;
      if (!tb) return -1;
      if (ta !== tb) return tb.localeCompare(ta);
      return a.id.localeCompare(b.id);
    })
    .map((item) => `${item.type}:${item.id}`);
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

  const homeRes = await fetch(`${HUB_URL}/api/website/home`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const homeJson = (await homeRes.json()) as { data?: { items?: HomeItem[] }; error?: string };
  if (!homeRes.ok || !homeJson.data?.items) {
    throw new Error(`home_api_failed:${homeRes.status}:${homeJson.error ?? ""}`);
  }
  const items = homeJson.data.items;
  const workIds = items.filter((item) => item.type === "work").map((item) => item.id);
  const { data: workYears, error: yearErr } = await siteAdmin
    .from("works")
    .select("id, year")
    .in("id", workIds);
  if (yearErr) throw yearErr;
  const yearById = new Map(
    ((workYears ?? []) as Array<{ id: string; year: string | null }>).map((row) => [
      row.id,
      row.year
    ])
  );

  const unpinnedActual = items
    .filter((item) => !item.pinned)
    .map((item) => `${item.type}:${item.id}`);
  const unpinnedExpected = expectedUnpinnedOrder(items, yearById);
  report.sortMatch = JSON.stringify(unpinnedActual) === JSON.stringify(unpinnedExpected);
  report.unpinnedSample = items
    .filter((item) => !item.pinned)
    .slice(0, 8)
    .map((item) => ({
      key: `${item.type}:${item.id}`,
      sortKey: sortKey(item, yearById) || "(none→last)",
      year: item.type === "work" ? yearById.get(item.id) ?? null : null,
      published_at: item.published_at,
      title: item.content?.title?.ko || item.content?.title?.en || ""
    }));
  report.workYearFieldUsed = "works.year";

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, hubUrl);

  await page.goto(`${HUB_URL}/website/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1500);
  report.cells = await page.locator(".ha-cell").count();
  report.dragHandles = await page.locator(".ha-chip--drag").count();
  await page.screenshot({ path: resolve(OUT, "01-home-admin.png"), fullPage: true });

  const cells = page.locator(".ha-cell");
  const cellCount = await cells.count();
  if (cellCount < 2) throw new Error("need_at_least_2_cells");

  // Find an unpinned cell to drag onto the first cell (if first is already target)
  let fromIndex = -1;
  for (let i = 1; i < Math.min(cellCount, 8); i += 1) {
    const pinned = await cells.nth(i).evaluate((el) => el.classList.contains("is-pinned"));
    if (!pinned) {
      fromIndex = i;
      break;
    }
  }
  if (fromIndex < 0) fromIndex = Math.min(2, cellCount - 1);

  const fromCell = cells.nth(fromIndex);
  const toCell = cells.nth(0);
  const fromTitle = await fromCell.locator(".ha-cell__title").innerText();
  const handle = fromCell.locator(".ha-chip--drag");
  await handle.scrollIntoViewIfNeeded();
  await handle.dragTo(toCell);
  await page.waitForTimeout(500);

  const firstTitle = await cells.nth(0).locator(".ha-cell__title").innerText();
  report.dragMoved = firstTitle.trim() === fromTitle.trim();
  report.firstPinnedAfterDrag = await cells.nth(0).evaluate((el) => el.classList.contains("is-pinned"));
  report.pinnedCountAfterDrag = await page.locator(".ha-cell.is-pinned").count();
  await page.screenshot({ path: resolve(OUT, "02-after-drag.png"), fullPage: false });

  await page.locator("button.ha-btn", { hasText: "저장" }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUT, "03-saved.png"), fullPage: false });

  await page.locator("button.ha-btn", { hasText: "게시" }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(OUT, "04-published.png"), fullPage: false });

  const afterRes = await fetch(`${HUB_URL}/api/website/home`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const afterJson = (await afterRes.json()) as { data?: { items?: HomeItem[] } };
  const afterItems = afterJson.data?.items ?? [];
  report.afterFirstKey = afterItems[0] ? `${afterItems[0].type}:${afterItems[0].id}` : null;
  report.afterFirstPinned = afterItems[0]?.pinned ?? null;
  report.afterFirstPinSort = afterItems[0]?.pin_sort ?? null;

  const site = await context.newPage();
  await site.goto(`${SITE_URL}/ko`, { waitUntil: "networkidle", timeout: 120_000 });
  await site.waitForTimeout(2000);
  const publicTitles = await site.locator(".main-grid__item .main-grid__title, .main-grid__item h2, .main-grid__item h3").allInnerTexts().catch(() => []);
  // fallback: grab alt/text from cards
  const cardTexts = await site.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".main-grid__item"));
    return nodes.slice(0, 6).map((node) => (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80));
  });
  report.publicFirstSnippets = cardTexts;
  report.publicTitleMatch = cardTexts.some((text) => text.includes(fromTitle.trim().slice(0, 12)));
  await site.screenshot({ path: resolve(OUT, "05-public-home.png"), fullPage: true });

  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const ok =
    report.sortMatch === true &&
    (report.dragHandles as number) > 0 &&
    report.dragMoved === true &&
    report.firstPinnedAfterDrag === true;

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
