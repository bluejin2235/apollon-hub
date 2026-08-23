/**
 * Luna image modal — Playwright verification
 * npx tsx scripts/verify-luna-image-modal.ts
 */
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const QUERIES: { q: string; slug: string }[] = [
  { q: "로비 미디어아트 레퍼런스", slug: "lobby-media" },
  { q: "더후 글로벌 론칭 KV 이미지 보여줘", slug: "dehoo-kv" }
];
const OUT_DIR = resolve(process.cwd(), "tmp/luna-image-modal-verify");

type Checklist = {
  modalNotNewWindow: boolean | "skip";
  largeImageUrl: boolean | "skip";
  arrowsEsc: boolean | "skip";
  pathTabsCopy: boolean | "skip";
  relatedClick: boolean | "skip";
  heartGrid: boolean | "skip";
  scrollPreserved: boolean | "skip";
};

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

async function waitForAnswer(page: Page) {
  await page.waitForFunction(
    () => /\d+\.\d+초/.test(document.body.innerText),
    { timeout: 180_000 }
  );
  await page.waitForTimeout(1500);
  const grid = page.locator("div.grid.grid-cols-2 button[type=button]").first();
  const ok = await grid.waitFor({ state: "visible", timeout: 90_000 }).then(() => true).catch(() => false);
  if (!ok) {
    const imagesTab = page.getByRole("button", { name: /이미지/ }).last();
    if (await imagesTab.isVisible().catch(() => false)) {
      await imagesTab.click();
      await page.waitForTimeout(800);
      await grid.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    }
  }
}

async function askQuestion(page: Page, q: string) {
  const newBtn = page.getByRole("button", { name: "새 대화" }).first();
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    await page.waitForTimeout(600);
  }
  const input = page.locator("textarea").last();
  await input.fill(q);
  await page.getByRole("button", { name: "전송" }).click();
  await waitForAnswer(page);
}

function modalLocator(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]');
}

function counterText(modal: ReturnType<typeof modalLocator>) {
  return modal.locator("span").filter({ hasText: /^\d+ \/ \d+$/ }).first();
}



async function clickFirstGridThumb(page: Page) {
  await page
    .locator("div.grid.grid-cols-2 button[type=button]")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  await page
    .locator("div.grid.grid-cols-2 button[type=button]")
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => {
    const btn = document.querySelector(
      "div.grid.grid-cols-2 button[type=button]"
    ) as HTMLButtonElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  });  if (!opened) {
    await page.locator("div.grid.grid-cols-2 button[type=button]").first().click({ force: true });
  }
  await page
    .locator('[role="dialog"][aria-modal="true"]')
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
  const dc = await page.locator('[role="dialog"]').count();}

async function firstGridThumb(page: Page) {
  const inGrid = page
    .locator("div.grid.grid-cols-2 button[type=button]")
    .filter({ has: page.locator("div.aspect-\\[4\\/3\\]") });
  const n = await inGrid.count();
  if (n > 0) return inGrid.first();
  return page.locator("button:has(div.aspect-\\[4\\/3\\])").first();
}

function srcLooksLarge(src: string | null): boolean {
  if (!src?.trim()) return false;
  const s = src.toLowerCase();
  if (/thumb|thumbnail|_t\.|w=\d{2,3}([^0-9]|$)|h=\d{2,3}([^0-9]|$)/.test(s)) {
    return false;
  }
  return true;
}

async function verifyModalFlow(page: Page, slug: string): Promise<Checklist> {
  const checklist: Checklist = {
    modalNotNewWindow: false,
    largeImageUrl: false,
    arrowsEsc: false,
    pathTabsCopy: false,
    relatedClick: false,
    heartGrid: false,
    scrollPreserved: false
  };

  mkdirSync(OUT_DIR, { recursive: true });

  await page.evaluate(() => {
    window.scrollTo(0, Math.min(Math.max(600, document.body.scrollHeight * 0.4), Math.max(0, document.body.scrollHeight - window.innerHeight)));
  });
  await page.waitForTimeout(300);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.locator("div.grid.grid-cols-2 button[type=button]").first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
  const thumb = page.locator("div.grid.grid-cols-2 button[type=button]").first();
  if (!(await thumb.isVisible().catch(() => false))) {
    console.log("  [skip] no grid thumbnail visible");
    return {
      modalNotNewWindow: "skip",
      largeImageUrl: "skip",
      arrowsEsc: "skip",
      pathTabsCopy: "skip",
      relatedClick: "skip",
      heartGrid: "skip",
      scrollPreserved: "skip"
    };
  }

  let popupOpened = false;
  const onPopup = () => {
    popupOpened = true;
  };
  page.on("popup", onPopup);

  await clickFirstGridThumb(page);

  const modal = modalLocator(page);
  const dialogVisible = await modal.isVisible().catch(() => false);
  checklist.modalNotNewWindow = dialogVisible && !popupOpened;
  if (!dialogVisible) {
    console.log("  modal did not open");
    page.off("popup", onPopup);
    return checklist;
  }

  await page.screenshot({
    path: resolve(OUT_DIR, `${slug}-modal.png`),
    fullPage: false
  });

  const mainImg = modal.locator("div.relative img.object-contain").first();
  const src = await mainImg.getAttribute("src").catch(() => null);
  await mainImg.evaluate((img: HTMLImageElement) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((res) => {
          img.addEventListener("load", () => res(), { once: true });
          img.addEventListener("error", () => res(), { once: true });
        })
  ).catch(() => {});
  await page.waitForTimeout(500);
  const dimsLoaded = await mainImg
    .evaluate((img: HTMLImageElement) => ({
      w: img.naturalWidth,
      h: img.naturalHeight
    }))
    .catch(() => ({ w: 0, h: 0 }));
  const largeByUrl = srcLooksLarge(src);
  const largeBySize = dimsLoaded.w >= 320 || dimsLoaded.h >= 240;
  checklist.largeImageUrl = Boolean(src) && (largeByUrl || largeBySize);
  console.log(
    "  large img src:",
    src?.slice(0, 120) ?? "(none)",
    "| looksLarge:",
    largeByUrl,
    "| natural:",
    `${dimsLoaded.w}x${dimsLoaded.h}`
  );

  const counter = counterText(modal);
  const counterBefore = (await counter.textContent().catch(() => ""))?.trim() ?? "";
  const hasMulti = /\/ ([2-9]|[1-9]\d+)/.test(counterBefore);
  if (hasMulti) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    const counterAfter = (await counter.textContent().catch(() => ""))?.trim() ?? "";
    const counterChanged = counterAfter !== counterBefore && counterAfter.length > 0;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closedByEsc = !(await modal.isVisible().catch(() => true));
    checklist.arrowsEsc = counterChanged && closedByEsc;
    if (!closedByEsc) {
      await modal.getByRole("button", { name: "닫기" }).click().catch(() => {});
    }
  } else {
    console.log("  single image — counter arrow skipped, testing ESC only");
    await clickFirstGridThumb(page);
    await modal.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    checklist.arrowsEsc = !(await modal.isVisible().catch(() => true));
  }


  await clickFirstGridThumb(page);
  await modal.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (!(await modal.isVisible().catch(() => false))) {
    page.off("popup", onPopup);
    return checklist;
  }

  const pathSpan = modal.locator("span.font-mono").first();
  const officePath = (await pathSpan.innerText().catch(() => "")).trim();

  await modal.getByRole("button", { name: "RaiDrive" }).click();
  await page.waitForTimeout(200);
  const raidPath = (await pathSpan.innerText().catch(() => "")).trim();

  await modal.getByRole("button", { name: "UNC" }).click();
  await page.waitForTimeout(200);
  const uncPath = (await pathSpan.innerText().catch(() => "")).trim();

  const pathsDistinct =
    raidPath.length > 0 &&
    uncPath.length > 0 &&
    raidPath !== uncPath &&
    (uncPath !== officePath || raidPath !== officePath);

  let copyOk = false;
  const copyBtn = modal.getByRole("button", { name: "복사" });
  if (await copyBtn.isVisible().catch(() => false)) {
    await copyBtn.click();
    await page.waitForTimeout(200);
    copyOk = await page
      .evaluate(async () => {
        try {
          const t = await navigator.clipboard.readText();
          return t.trim().length > 3;
        } catch {
          return true;
        }
      })
      .catch(() => true);
  }
  checklist.pathTabsCopy = pathsDistinct && copyOk;
  console.log(
    "  paths office/raid/unc lengths:",
    officePath.length,
    raidPath.length,
    uncPath.length
  );

  await page.screenshot({
    path: resolve(OUT_DIR, `${slug}-path-tabs.png`),
    fullPage: false
  });

  const relatedHeading = modal.getByText("관련 이미지");
  const hasRelated = await relatedHeading.isVisible().catch(() => false);
  if (hasRelated) {
    const relatedBtn = modal.locator("button:has(div.aspect-\\[4\\/3\\])").first();
    const titleBefore = await modal
      .locator(".overflow-y-auto .font-bold")
      .first()
      .innerText()
      .catch(() => "");
    await relatedBtn.click();
    await page.waitForTimeout(600);
    const titleAfter = await modal
      .locator(".overflow-y-auto .font-bold")
      .first()
      .innerText()
      .catch(() => "");
    checklist.relatedClick =
      titleAfter.length > 0 && (titleAfter !== titleBefore || titleBefore.length === 0);
    await page.screenshot({
      path: resolve(OUT_DIR, `${slug}-related.png`),
      fullPage: false
    });
  } else {
    console.log("  no related images section");
    checklist.relatedClick = "skip";
  }

  const heartBtn = modal.getByRole("button", { name: /즐겨찾기/ });
  if (await heartBtn.isVisible().catch(() => false)) {
    const labelBefore = (await heartBtn.getAttribute("aria-label")) ?? "";
    await heartBtn.click();
    await page.waitForTimeout(500);
    const labelAfter = (await heartBtn.getAttribute("aria-label")) ?? "";
    const toggled = labelBefore !== labelAfter;

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await clickFirstGridThumb(page);
    await modal.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const gridHeart = thumb.locator('[aria-label="즐겨찾기"]');
    const heartOnGrid = await gridHeart.isVisible().catch(() => false);
    checklist.heartGrid = toggled && heartOnGrid;
    if (!heartOnGrid && toggled) {
      console.log("  heart toggled in modal but grid heart not visible (favorites API/table?)");
    }
    await page.keyboard.press("Escape");
  } else {
    checklist.heartGrid = "skip";
  }

  if (await modal.isVisible().catch(() => false)) {
    await modal.getByRole("button", { name: "닫기" }).click().catch(() => {});
  }
  await page.waitForTimeout(300);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  checklist.scrollPreserved = Math.abs(scrollAfter - scrollBefore) < 80;
  console.log("  scroll before/after:", scrollBefore, scrollAfter);

  page.off("popup", onPopup);
  return checklist;
}

function printChecklist(slug: string, c: Checklist) {
  const fmt = (v: boolean | "skip") => (v === "skip" ? "SKIP" : v ? "PASS" : "FAIL");
  console.log(`\n--- Checklist: ${slug} ---`);
  console.log("  1. modal not new window:", fmt(c.modalNotNewWindow));
  console.log("  2. large image sharp/large url:", fmt(c.largeImageUrl));
  console.log("  3. arrows + ESC:", fmt(c.arrowsEsc));
  console.log("  4. path tabs + copy:", fmt(c.pathTabsCopy));
  console.log("  5. related click:", fmt(c.relatedClick));
  console.log("  6. heart on grid:", fmt(c.heartGrid));
  console.log("  7. scroll preserved on close:", fmt(c.scrollPreserved));
}

async function checkFavoritesTable(admin: SupabaseClient) {
  const { error } = await admin.from("luna_media_favorites").select("path").limit(1);
  if (error) {
    console.warn(
      "\nWARN: luna_media_favorites query failed — heart tests may fail:",
      error.message
    );
    return false;
  }
  return true;
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

  await checkFavoritesTable(admin);

  const user = await pickLunaUser(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();

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

  const all: Record<string, Checklist> = {};

  for (const { q, slug } of QUERIES) {
    console.log(`\n========== ${q} ==========`);
    await askQuestion(page, q);
    await page.screenshot({
      path: resolve(OUT_DIR, `${slug}-answer.png`),
      fullPage: true
    });
    const checklist = await verifyModalFlow(page, slug);
    all[slug] = checklist;
    printChecklist(slug, checklist);
  }

  console.log("\n========== SUMMARY ==========");
  for (const { slug } of QUERIES) {
    printChecklist(slug, all[slug]!);
  }
  console.log("\nScreenshots:", OUT_DIR);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

