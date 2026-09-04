/**
 * 작은 이미지 확인 팝업 — 본문 업로드 · 뱃지 · 점검 · 대표 거부
 * npx tsx scripts/verify-small-image-confirm.ts
 */
import { config, parse } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomFillSync } from "node:crypto";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = process.env.VERIFY_WORK_ID ?? "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const INSIGHT_ID = process.env.VERIFY_INSIGHT_ID ?? "ed2cba6a-ade7-4f14-be32-980f0a813aef";
const SHOT_DIR = resolve(process.cwd(), "tmp/small-image-verify");

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

async function makeJpeg(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  randomFillSync(raw);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function measureConfirm(page: Page) {
  return page.evaluate(() => {
    const holder = document.querySelector(".sic-holder");
    const image = document.querySelector(".sic-svg image");
    if (!holder || !image) return null;
    const hr = holder.getBoundingClientRect();
    const ir = image.getBoundingClientRect();
    return {
      holderW: Math.round(hr.width),
      holderH: Math.round(hr.height),
      imgW: Math.round(ir.width),
      imgH: Math.round(ir.height),
      widthRatio: hr.width ? Number((ir.width / hr.width).toFixed(3)) : 0,
      lead: document.querySelector(".sic-lead")?.textContent?.trim() ?? null,
      ruler: document.querySelector(".sic-ruler")?.textContent?.trim() ?? null,
      px: document.querySelector(".sic-px-svg")?.textContent?.trim() ?? null,
      foot: document.querySelector(".sic-foot")?.textContent?.replace(/\s+/g, " ").trim() ?? null
    };
  });
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const dir = resolve(tmpdir(), `sic-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const smallPath = resolve(dir, "1200x800.jpg");
  writeFileSync(smallPath, await makeJpeg(1200, 800));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const hubHeaders = {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json"
  };

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", WORK_ID)
    .neq("kind", "interview")
    .order("sort", { ascending: true })
    .limit(1);
  const sectionId = sections?.[0]?.id as string | undefined;
  if (!sectionId) throw new Error("no work section");

  const created = await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks`, {
    method: "POST",
    headers: hubHeaders,
    body: JSON.stringify({ preset: "full", sort: 997 })
  });
  const createdJson = (await created.json()) as { data?: { id?: string }; error?: string };
  const blockId = createdJson.data?.id;
  if (!blockId) throw new Error(`create block failed: ${JSON.stringify(createdJson)}`);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("crash", () => console.error("page crash"));
  page.on("pageerror", (err) => console.error("pageerror", err.message));
  await login(context, page, session, supabaseUrl);

  const report: Record<string, unknown> = { blockId, shots: SHOT_DIR };

  try {
    await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=content`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("button", { name: "전체 펼치기" }).click();
    await page.waitForTimeout(800);

    const block = page.locator(`#content-block-${blockId}`);
    await block.waitFor({ state: "visible", timeout: 30_000 });
    if (!(await block.getAttribute("class"))?.includes(" on")) {
      await block.locator(".bh").click();
    }

    const fileInput = block.locator('input[type="file"]').first();
    await fileInput.setInputFiles(smallPath);
    await page.locator(".sic-full").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: "취소", exact: true }).evaluate((el) =>
      (el as HTMLButtonElement).click()
    );
    await page.locator(".sic-full").waitFor({ state: "hidden", timeout: 10_000 });
    report.cancelPill = await block.locator(".sic-pill").count();
    await fileInput.setInputFiles(smallPath);
    await page.locator(".sic-full").waitFor({ state: "visible", timeout: 20_000 });
    report.bodyPopup = await measureConfirm(page);
    console.log("bodyPopup", JSON.stringify(report.bodyPopup));
    await page.locator(".sic-full").screenshot({ path: resolve(SHOT_DIR, "01-work-body-confirm.png") });
    console.log("clicked upload soon");

    const uploaded = page.waitForResponse(
      (res) => res.url().includes("/api/website/upload") && res.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page.locator(".sic-btn-warn").evaluate((el) => (el as HTMLButtonElement).click());
    const upRes = await uploaded;
    report.bodyUploadStatus = upRes.status();
    await page.locator(".sic-full").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => null);
    await page.waitForTimeout(2500);
    await block.scrollIntoViewIfNeeded();
    report.bodyPill = await block.locator(".sic-pill").first().textContent().catch(() => null);
    report.bodyHint = await block.locator(".sic-hint").first().textContent().catch(() => null);
    await block.screenshot({ path: resolve(SHOT_DIR, "02-work-body-badge.png") });

    await page.getByRole("button", { name: "점검", exact: true }).click();
    await page.waitForTimeout(600);
    const warnRow = page.locator("text=작은 이미지가").first();
    report.checkTitle = await warnRow.textContent().catch(() => null);
    report.checkKind = await page.locator("text=권장").first().isVisible().catch(() => false);
    report.checkRequired = await page
      .locator("text=작은 이미지가")
      .locator("xpath=ancestor::div[contains(@class,'flex')][1]")
      .locator("text=필수")
      .count()
      .catch(() => -1);
    await page.screenshot({ path: resolve(SHOT_DIR, "03-work-check.png") });

    await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=basic`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    await page.getByText("대표 이미지", { exact: false }).first().waitFor({ timeout: 60_000 });
    const keyInput = page.locator('input[type="file"][accept*="image"]').first();
    await keyInput.setInputFiles(smallPath);
    const reject = page.getByText("긴 변이 1600 이상이어야 합니다. 지금 1200×800 입니다");
    report.keyReject = await reject.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    report.keyPopup = await page.locator(".sic-full").count();
    await reject.scrollIntoViewIfNeeded().catch(() => null);
    await page.locator("text=긴 변이 1600 이상이어야 합니다").first().screenshot({
      path: resolve(SHOT_DIR, "04-work-key-reject.png")
    }).catch(() => page.screenshot({ path: resolve(SHOT_DIR, "04-work-key-reject.png") }));

    const { data: insightSections } = await siteAdmin
      .from("insight_sections")
      .select("id")
      .eq("insight_id", INSIGHT_ID)
      .order("sort", { ascending: true })
      .limit(1);
    const insightSectionId = insightSections?.[0]?.id as string | undefined;
    if (insightSectionId) {
      const insightCreated = await fetch(`${HUB_URL}/api/website/insights/${INSIGHT_ID}/blocks`, {
        method: "POST",
        headers: hubHeaders,
        body: JSON.stringify({ preset: "full", section_id: insightSectionId, sort: 997 })
      });
      const insightJson = (await insightCreated.json()) as { data?: { id?: string } };
      const insightBlockId = insightJson.data?.id;
      report.insightBlockId = insightBlockId;
      if (insightBlockId) {
        await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
          waitUntil: "domcontentloaded",
          timeout: 120_000
        });
        await page.waitForTimeout(1000);
        const iblock = page.locator(`#insight-block-${insightBlockId}`);
        await iblock.waitFor({ state: "visible", timeout: 30_000 });
        if (!(await iblock.getAttribute("class"))?.includes(" on")) {
          await iblock.locator(".bh").click();
        }
        const iInput = iblock.locator('input[type="file"]').first();
        await iInput.setInputFiles(smallPath);
        await page.locator(".sic-full").waitFor({ state: "visible", timeout: 20_000 });
        report.insightPopup = await measureConfirm(page);
        console.log("insightPopup", JSON.stringify(report.insightPopup));
        await page.locator(".sic-full").screenshot({ path: resolve(SHOT_DIR, "05-insight-body-confirm.png") });
        const iUpWait = page.waitForResponse(
          (res) => res.url().includes("/api/website/upload") && res.request().method() === "POST",
          { timeout: 120_000 }
        );
        await page.locator(".sic-btn-warn").evaluate((el) => (el as HTMLButtonElement).click());
        report.insightUploadStatus = (await iUpWait).status();
        await page.waitForTimeout(2500);
        await iblock.scrollIntoViewIfNeeded();
        report.insightPill = await iblock.locator(".sic-pill").first().textContent().catch(() => null);
        await iblock.screenshot({ path: resolve(SHOT_DIR, "06-insight-body-badge.png") });
        await fetch(`${HUB_URL}/api/website/insights/${INSIGHT_ID}/blocks/${insightBlockId}`, {
          method: "DELETE",
          headers: hubHeaders
        });
      }
    }
  } finally {
    await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks/${blockId}`, {
      method: "DELETE",
      headers: hubHeaders
    });
    await browser.close();
    try {
      unlinkSync(smallPath);
    } catch {
      /* ignore */
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
