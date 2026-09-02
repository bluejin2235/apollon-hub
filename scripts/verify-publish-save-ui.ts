/**
 * 2단계 저장/공개 분리 — Playwright 실측
 * npx tsx scripts/verify-publish-save-ui.ts
 */
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = process.env.WEBSITE_API_URL ?? "http://localhost:3100";
const TEST_SLUG = "trendyyouth-town-media-architecture-concept-old";
const OUT_DIR = resolve(process.cwd(), "tmp/publish-save-ui-verify");

type ProfileRow = { id: string; email: string | null; role: string | null };

type SavedState = {
  workId: string;
  wasHidden: boolean;
};

function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

async function pickAdminUser(admin: SupabaseClient): Promise<ProfileRow> {
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("role", "슈퍼관리자")
    .limit(1);
  const row = (supers ?? [])[0] as ProfileRow | undefined;
  if (row?.email) return row;
  throw new Error("no super admin user");
}

async function createSession(
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
  email: string,
) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function login(
  context: BrowserContext,
  page: Page,
  session: Awaited<ReturnType<typeof createSession>>,
  supabaseUrl: string,
) {
  const key = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;
  const packed = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
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
  console.log("cookie chunks written:", cookies.map((c) => c.name).join(", "));
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, JSON.stringify(v)),
    { k: key, v: session },
  );
  await page.waitForTimeout(500);
}

async function bottomBar(page: Page) {
  return page.locator(".sticky.bottom-0").last();
}

async function visibleButtons(page: Page) {
  const bar = await bottomBar(page);
  const names: string[] = [];
  for (const name of ["미리보기", "전체 저장", "공개 전 점검", "공개하기", "감추기", "다시 공개"]) {
    const btn = bar.getByRole("button", { name, exact: true });
    if (await btn.isVisible().catch(() => false)) names.push(name);
  }
  return names;
}

async function siteListsWork(slug: string): Promise<boolean> {
  const res = await fetch(`${SITE_URL}/works/${slug}`, { redirect: "manual" });
  return res.status === 200;
}

async function adminFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${HUB_URL}/api/website/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function fetchWorkState(token: string, slug: string): Promise<SavedState> {
  const res = await adminFetch(`works?q=${encodeURIComponent(slug)}&limit=20`, token);
  const payload = res.body as {
    data?: { items?: Array<{ id: string; slug: string; is_hidden?: boolean; site_visibility?: string }> };
    error?: string;
  };
  const items = payload?.data?.items ?? [];
  const work = items.find((item) => item.slug === slug);
  if (!work?.id) {
    throw new Error(`work_not_found:${res.status}:${payload?.error ?? "no_match"}`);
  }
  return {
    workId: work.id,
    wasHidden: work.site_visibility === "hidden" || Boolean(work.is_hidden),
  };
}

async function hideViaApi(token: string, workId: string) {
  const res = await adminFetch("hide", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId }),
  });
  if (!res.ok) throw new Error(`hide_failed:${res.status}`);
}

async function unhideViaApi(token: string, workId: string) {
  const res = await adminFetch("unhide", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId }),
  });
  if (!res.ok) throw new Error(`unhide_failed:${res.status}`);
}

async function restoreState(token: string, saved: SavedState) {
  if (saved.wasHidden) await hideViaApi(token, saved.workId);
  else await unhideViaApi(token, saved.workId);
}

async function openEditor(page: Page, workId: string, tab: "basic" | "content" = "basic") {
  await page.goto(`${HUB_URL}/website/works`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByText("홈페이지").first().waitFor({ timeout: 60_000 });
  await page.goto(`${HUB_URL}/website/works/${workId}?tab=${tab}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).waitFor({ timeout: 60_000 });
  if (tab === "content") {
    await page.getByRole("button", { name: "본문", exact: true }).click();
    await page.locator(".blk, .sec").first().waitFor({ timeout: 60_000 });
  }
}

async function testPartialSaveContent(page: Page, workId: string) {
  await openEditor(page, workId, "content");
  const block = page.locator(".blk").first();
  await block.scrollIntoViewIfNeeded();
  if (await block.evaluate((el) => el.classList.contains("blk") && !el.classList.contains("on"))) {
    await block.locator(".bh").click();
  }
  const textarea = block.locator("textarea.i, textarea").first();
  if (!(await textarea.isVisible().catch(() => false))) {
    const input = block.locator("input.i").first();
    await input.waitFor({ timeout: 15_000 });
    const before = await input.inputValue();
    await input.fill(`${before}x`);
    const partialBtn = block.getByRole("button", { name: /저장/ }).first();
    await block.getByRole("button", { name: "저장 안 함" }).waitFor({ timeout: 15_000 });
    await partialBtn.click();
    await block.getByRole("button", { name: "방금 저장" }).waitFor({ timeout: 30_000 });
    await input.fill(before);
    await partialBtn.click();
    await block.getByRole("button", { name: "방금 저장" }).waitFor({ timeout: 30_000 });
    return true;
  }
  const before = await textarea.inputValue();
  await textarea.fill(`${before}x`);
  const partialBtn = block.getByRole("button", { name: /저장/ }).first();
  await block.getByRole("button", { name: "저장 안 함" }).waitFor({ timeout: 15_000 });
  await partialBtn.click();
  await block.getByRole("button", { name: "방금 저장" }).waitFor({ timeout: 30_000 });
  await textarea.fill(before);
  await partialBtn.click();
  await block.getByRole("button", { name: "방금 저장" }).waitFor({ timeout: 30_000 });
  return true;
}

async function testPublishModal(page: Page) {
  const bar = await bottomBar(page);
  await bar.getByRole("button", { name: "공개하기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 60_000 });
  await page.getByText("바뀐 칸").waitFor({ timeout: 60_000 });
  const note = page.locator("#publish-change-note");
  await note.waitFor({ timeout: 90_000 });
  const noteValue = await note.inputValue();
  if (!noteValue.trim()) throw new Error("publish note empty");
  await page.getByRole("button", { name: "취소" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  return { noteFilled: noteValue.trim().length > 0 };
}

async function testDraftButtons(page: Page) {
  await page.goto(`${HUB_URL}/website/works`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByRole("button", { name: "초안" }).click();
  await page.waitForTimeout(800);
  const draftRow = page.locator("tr").filter({ hasText: "초안" }).first();
  if (!(await draftRow.isVisible().catch(() => false))) {
    return { skipped: true, buttons: [] as string[] };
  }
  await draftRow.getByRole("link").first().click();
  await page.waitForURL(/\/website\/works\//, { timeout: 60_000 });
  const buttons = await visibleButtons(page);
  return { skipped: false, buttons };
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
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const user = await pickAdminUser(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/stats/search`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.locator("h2.ws-pt").waitFor({ timeout: 60_000 });

  const saved = await fetchWorkState(session.access_token, TEST_SLUG);
  if (saved.wasHidden) {
    await unhideViaApi(session.access_token, saved.workId);
  }

  const report: Record<string, unknown> = { slug: TEST_SLUG, workId: saved.workId };

  try {
    try {
      await openEditor(page, saved.workId);
    } catch (err) {
      mkdirSync(OUT_DIR, { recursive: true });
      const failShot = resolve(OUT_DIR, "open-editor-fail.png");
      await page.screenshot({ path: failShot, fullPage: true });
      const bodyText = await page.locator("body").innerText();
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\nbody:${bodyText.slice(0, 1200)}\nshot:${failShot}`,
      );
    }
    const liveBadge = page.getByText("공개", { exact: true }).first();
    report.liveBadge = await liveBadge.isVisible();
    report.liveButtons = await visibleButtons(page);
    report.liveOk =
      (report.liveButtons as string[]).includes("공개하기") &&
      (report.liveButtons as string[]).includes("감추기") &&
      (report.liveButtons as string[]).includes("공개 전 점검");

    report.partialSaveOk = await testPartialSaveContent(page, saved.workId);

    await openEditor(page, saved.workId, "basic");

    report.publishModal = await testPublishModal(page);

    report.onSiteBeforeHide = await siteListsWork(TEST_SLUG);

    const bar = await bottomBar(page);
    await bar.getByRole("button", { name: "감추기", exact: true }).click();
    await page.getByText("사이트에서 보이지 않습니다").waitFor({ timeout: 30_000 });
    report.hiddenMessage = true;
    report.hiddenButtons = await visibleButtons(page);
    report.hiddenOk =
      (report.hiddenButtons as string[]).includes("다시 공개") &&
      !(report.hiddenButtons as string[]).includes("공개하기") &&
      !(report.hiddenButtons as string[]).includes("감추기");

    await page.waitForTimeout(1500);
    report.onSiteAfterHide = await siteListsWork(TEST_SLUG);

    await bar.getByRole("button", { name: "다시 공개", exact: true }).click();
    await page.waitForTimeout(3000);
    report.restoredLiveButtons = await visibleButtons(page);
    report.onSiteAfterUnhide = await siteListsWork(TEST_SLUG);

    report.draft = await testDraftButtons(page);

    const shot = resolve(OUT_DIR, "publish-save-ui.png");
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshot = shot;
  } finally {
    await browser.close();
    await restoreState(session.access_token, saved);
  }

  console.log("\n=== publish/save UI verify ===");
  console.log(JSON.stringify(report, null, 2));

  const failed =
    !report.liveOk ||
    !report.partialSaveOk ||
    !(report.publishModal as { noteFilled: boolean }).noteFilled ||
    !report.hiddenOk ||
    report.onSiteBeforeHide !== true ||
    report.onSiteAfterHide !== false ||
    report.onSiteAfterUnhide !== true;

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
