/**
 * 인사이트 공개: 대체텍스트 차단 문구 · 가기 · 성공 시 팝업 닫힘 · 워크 회귀
 * npx tsx scripts/verify-insight-publish-modal.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = resolve(process.cwd(), "scripts/out-insight-publish-modal");
const INSIGHT_ID = "ed2cba6a-ade7-4f14-be32-980f0a813aef";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";

const CONTENT_URL = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
const CONTENT_SERVICE = websiteEnv.SUPABASE_SECRET_KEY ?? websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
const HUB_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const HUB_SERVICE = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HUB_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
  if (linkErr || !link?.properties?.hashed_token) throw new Error(linkErr?.message ?? "no token");
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

async function login(context: BrowserContext, page: Page, session: Session, supabaseUrl: string) {
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

async function openPublishDialog(page: Page) {
  const pub = page.getByRole("button", { name: /^공개$|공개하기/ }).first();
  await pub.click({ force: true });
  await page.waitForTimeout(1200);
  const savePub = page.getByRole("button", { name: /저장하고 공개/ });
  if (await savePub.isVisible().catch(() => false)) {
    await savePub.click();
    await page.waitForTimeout(2500);
  }
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator("#publish-modal-title") });
  await dialog.waitFor({ state: "visible", timeout: 45_000 });
  return dialog;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const content = createClient(CONTENT_URL, CONTENT_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const hub = createClient(HUB_SB, HUB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const report: Record<string, unknown> = {
    skipHub: process.env.NEXT_PUBLIC_SKIP_PUBLISH_CHECK,
    skipSite: websiteEnv.NEXT_PUBLIC_SKIP_PUBLISH_CHECK
  };

  const { data: blocks } = await content
    .from("insight_blocks")
    .select("id, sort, preset")
    .eq("insight_id", INSIGHT_ID)
    .order("sort");
  const blockIds = (blocks ?? []).map((b) => b.id);
  const { data: images } = await content
    .from("insight_images")
    .select("id, block_id, alt, sort")
    .in("block_id", blockIds)
    .order("sort");
  const img = images?.[0];
  if (!img) throw new Error("no image");
  const backups = new Map((images ?? []).map((i) => [i.id, i.alt]));

  for (const i of images ?? []) {
    await content
      .from("insight_images")
      .update({ alt: { ko: "임시 대체텍스트", en: "temp alt" } })
      .eq("id", i.id);
  }
  await content.from("insight_images").update({ alt: { ko: "", en: "" } }).eq("id", img.id);

  // check view refresh may lag — nudge by touching insight
  await content
    .from("insights")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", INSIGHT_ID);

  const session = await createSession(hub, HUB_ANON, HUB_SB, await pickAdminEmail(hub));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, HUB_SB);

  // ——— 1·2: empty alt → fail message + 가기 ———
  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(4000);

  const checkBtn = page.getByRole("button", { name: /점검/ }).first();
  if (await checkBtn.count()) await checkBtn.click();
  await page.waitForTimeout(500);
  const checkBody = await page.locator("body").innerText();
  report.checkHasLocation = /본문\s*\d+번째\s*블록\s*·\s*이미지\s*\d+장/.test(checkBody);

  const goBtn = page.getByRole("button", { name: /^가기$/ }).first();
  report.goVisible = await goBtn.isVisible().catch(() => false);
  let scrolledToBlock = false;
  if (report.goVisible) {
    await goBtn.click();
    await page.waitForTimeout(800);
    scrolledToBlock = await page.evaluate(() => {
      const el = document.querySelector('[id^="insight-block-"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -40 && r.top < window.innerHeight;
    });
  }
  report.goScrollOk = scrolledToBlock;

  const dialog = await openPublishDialog(page);
  const note = dialog.locator("#publish-change-note");
  if (!(await note.inputValue()).trim()) await note.fill("검증 공개 차단");
  await dialog.getByRole("button", { name: /공개 확인/ }).click();
  await page.waitForTimeout(5000);

  const dialogText = await dialog.innerText();
  report.modalOpenAfterFail = await dialog.isVisible();
  report.failDialogText = dialogText.slice(0, 900);
  report.hasLocationFailMessage =
    /본문\s*\d+번째\s*블록\s*·\s*이미지\s*\d+장에\s*대체\s*텍스트가\s*없습니다/.test(dialogText);
  report.hasRawJsonFail = /publish_blocked\s*·\s*\{/.test(dialogText);
  await page.screenshot({ path: resolve(OUT, "01-fail-reason.png"), fullPage: true });

  await dialog.getByRole("button", { name: "취소" }).click().catch(() => null);

  // ——— 3: fill alt → publish closes modal ———
  for (const i of images ?? []) {
    const bak = backups.get(i.id);
    const ko =
      bak && typeof bak === "object" && typeof (bak as { ko?: string }).ko === "string"
        ? (bak as { ko: string }).ko.trim()
        : "";
    await content
      .from("insight_images")
      .update({
        alt: ko ? bak : { ko: `대체텍스트 ${i.id.slice(0, 6)}`, en: "alt" }
      })
      .eq("id", i.id);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const dialog2 = await openPublishDialog(page);
  const note2 = dialog2.locator("#publish-change-note");
  if (!(await note2.inputValue()).trim()) await note2.fill("검증 공개 성공");
  await dialog2.getByRole("button", { name: /공개 확인/ }).click();
  await page.waitForTimeout(10000);
  report.modalClosedAfterSuccess = !(await dialog2.isVisible().catch(() => false));
  report.successBodySnippet = (await page.locator("body").innerText()).slice(0, 400);
  await page.screenshot({ path: resolve(OUT, "02-success-closed.png"), fullPage: true });

  // ——— 4: work publish modal still opens/closes similarly ———
  await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /^공개$|공개하기/ }).first().click();
  await page.waitForTimeout(1500);
  const saveWork = page.getByRole("button", { name: /저장하고 공개/ });
  if (await saveWork.isVisible().catch(() => false)) {
    await saveWork.click();
    await page.waitForTimeout(3000);
  }
  const workDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.locator("#publish-modal-title") });
  const workModalVisible = await workDialog.isVisible().catch(() => false);
  report.workModalOpens = workModalVisible;
  if (workModalVisible) {
    await workDialog.getByRole("button", { name: "취소" }).click();
    await page.waitForTimeout(500);
    report.workModalClosesOnCancel = !(await workDialog.isVisible().catch(() => false));
  }
  await page.screenshot({ path: resolve(OUT, "03-work-modal.png"), fullPage: true });

  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
