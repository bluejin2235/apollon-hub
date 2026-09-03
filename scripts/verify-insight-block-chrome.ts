/**
 * 인사이트 블록 카드 크롬 확인 (로그인 포함)
 * npx tsx scripts/verify-insight-block-chrome.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const INSIGHT_ID = process.env.INSIGHT_ID ?? "4188f427-7224-4310-a640-26918b6f13ae";

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
  if (linkErr || !link.properties?.hashed_token) {
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("missing supabase env");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = await pickAdminEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForSelector(".insight-blks .blk", { timeout: 60_000 });

  const first = page.locator(".insight-blks .blk").first();
  await first.locator(".bh").click();
  await page.waitForTimeout(400);

  const header = await first.locator(".bh .kd").innerText();
  const hasPartial = (await first.getByRole("button", { name: "부분 저장" }).count()) > 0;
  const btnTexts = await first.locator(".ct button").allTextContents();
  const fam = await first.evaluate(
    (el) =>
      ["fam-accent", "fam-pro", "fam-success"].find((c) => el.classList.contains(c)) ?? null
  );
  const radius = await first.evaluate((el) => getComputedStyle(el).borderRadius);

  let dualDrop = false;
  let modalOk = false;
  let roundTrip = false;
  const textBlk = page.locator(".insight-blks .blk").filter({ hasText: "에디터" }).first();
  if ((await textBlk.count()) > 0) {
    if (!(await textBlk.locator(".bb").isVisible().catch(() => false))) {
      await textBlk.locator(".bh").click();
      await page.waitForTimeout(300);
    }
    dualDrop = (await textBlk.locator(".lead-drop").count()) >= 2;
    await textBlk.locator(".lead-drop").first().click();
    await page.waitForSelector(".lead-mw", { timeout: 15_000 });
    const editables = page.locator(".lead-mw [contenteditable='true']");
    modalOk = (await editables.count()) >= 2;
    const marker = `VERIFY-${Date.now()}`;
    await editables.nth(0).click();
    await page.keyboard.type(` ${marker}`);
    await page.locator(".lead-mwf .btn.acc").click();
    await page.waitForSelector(".lead-mw", { state: "detached", timeout: 10_000 });
    await textBlk.locator(".ct").getByRole("button", { name: "부분 저장", exact: true }).click();
    await page.waitForTimeout(1500);
    await textBlk.locator(".lead-drop").first().click();
    await page.waitForSelector(".lead-mw", { timeout: 15_000 });
    const html = await page.locator(".lead-mw [contenteditable='true']").nth(0).innerHTML();
    roundTrip = html.includes(marker);
    await page.locator(".lead-mwf .btn").filter({ hasText: "취소" }).click();
  }

  const imageBlk = page.locator(".insight-blks .blk.fam-pro").first();
  let imageInline = false;
  if ((await imageBlk.count()) > 0) {
    if (!(await imageBlk.locator(".bb").isVisible().catch(() => false))) {
      await imageBlk.locator(".bh").click();
      await page.waitForTimeout(300);
    }
    imageInline =
      (await imageBlk.locator(".fld", { hasText: "대체 텍스트" }).count()) > 0 &&
      (await imageBlk.getByRole("button", { name: "부분 저장" }).count()) > 0 &&
      (await imageBlk.locator(".c2", { hasText: "에디터" }).count()) === 0;
  }

  const noInlineRte =
    (await page.locator(".insight-blks .bb .rte, .insight-blks .bb [contenteditable]").count()) ===
    0;

  const report = {
    header,
    hasPartial,
    btnTexts: btnTexts.map((t) => t.trim()),
    fam,
    radius,
    dualDrop,
    modalOk,
    roundTrip,
    imageInline,
    noInlineRte
  };
  console.log(JSON.stringify(report, null, 2));

  const ok =
    hasPartial &&
    btnTexts[0]?.includes("부분 저장") &&
    Boolean(fam) &&
    noInlineRte &&
    (dualDrop ? modalOk && roundTrip : true);

  if (!ok) {
    console.error("VERIFY_FAIL");
    process.exitCode = 1;
  } else {
    console.log("VERIFY_OK");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
