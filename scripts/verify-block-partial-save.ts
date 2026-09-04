/**
 * 갤러리 블록 부분 저장 — 항상 클릭 · 대체 텍스트 강조 · 1600 안내 1회
 * npx tsx scripts/verify-block-partial-save.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=content`;
const HINT = "긴 변이 1600 픽셀 이상의 이미지를 권장합니다.";

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY;
  if (!siteUrl || !siteService) throw new Error("website supabase missing");
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", WORK_ID);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: galleryBlocks } = await siteAdmin
    .from("content_blocks")
    .select("id, preset, section_id")
    .eq("preset", "gallery-auto")
    .in("section_id", sectionIds);
  const galleryBlock = (galleryBlocks ?? [])[0];
  if (!galleryBlock) throw new Error("no gallery block");

  const { data: dbImagesBefore } = await siteAdmin
    .from("block_images")
    .select("id, alt, sort")
    .eq("block_id", galleryBlock.id)
    .order("sort");
  const imageCount = (dbImagesBefore ?? []).length;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  const blockPatches: Array<{ status: number; body: unknown }> = [];
  const imagePatches: Array<{ status: number; body: unknown }> = [];
  page.on("response", async (res) => {
    const method = res.request().method();
    if (method !== "PATCH") return;
    const url = res.url();
    let body: unknown = null;
    try {
      body = res.request().postDataJSON();
    } catch {
      body = res.request().postData();
    }
    const entry = { status: res.status(), body };
    if (url.includes("/images/")) imagePatches.push(entry);
    else if (url.includes("/blocks/")) blockPatches.push(entry);
  });

  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);

  const galleryHeader = page.locator(`#content-block-${galleryBlock.id}`);
  await galleryHeader.waitFor({ state: "visible", timeout: 30_000 });
  const isCollapsed = (await galleryHeader.getAttribute("class"))?.includes(" on") === false;
  if (isCollapsed) await galleryHeader.locator(".bh").click();
  await page.waitForTimeout(400);

  const partialSave = galleryHeader.getByRole("button", { name: "부분 저장" });
  const idleEnabled = await partialSave.isEnabled();
  const idleEmphasis = await partialSave.evaluate((el) =>
    el.className.includes("apollon-500")
  );
  const idleStatus = await galleryHeader.locator("text=저장할 것이 있습니다").count();

  const hintCount = await galleryHeader.locator(`text=${HINT}`).count();

  const autoSaveLabel = await galleryHeader.locator("text=이미지는 올리는 즉시 저장됩니다").count();

  await partialSave.click();
  await page.waitForTimeout(2000);
  const idleSavePatch = blockPatches.length;

  const imagesPanel = galleryHeader.locator("div.rounded-lg.border-dashed").first();
  const altKo = imagesPanel.getByRole("textbox").first();
  const originalAlt = await altKo.inputValue();
  const testAlt = `검증용 alt ${Date.now()}`.slice(0, 40);
  await altKo.fill(testAlt);
  await page.waitForTimeout(500);

  const dirtyEmphasis = await partialSave.evaluate((el) =>
    el.className.includes("apollon-500")
  );
  const dirtyStatus = await galleryHeader.locator("text=저장할 것이 있습니다").count();

  await page.waitForTimeout(2000);
  const imagePatchCount = imagePatches.length;

  await partialSave.click();
  await page.waitForTimeout(2500);

  const { data: dbImagesAfter } = await siteAdmin
    .from("block_images")
    .select("id, alt")
    .eq("block_id", galleryBlock.id)
    .order("sort");
  const savedAlt = (dbImagesAfter ?? [])[0]?.alt as { ko?: string } | null;
  const altInDb = savedAlt?.ko ?? null;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);
  const galleryAfter = page.locator(`#content-block-${galleryBlock.id}`);
  if ((await galleryAfter.getAttribute("class"))?.includes(" on") === false) {
    await galleryAfter.locator(".bh").click();
    await page.waitForTimeout(400);
  }
  const altAfterReload = await galleryAfter
    .locator("div.rounded-lg.border-dashed")
    .first()
    .getByRole("textbox")
    .first()
    .inputValue();

  if (originalAlt !== testAlt) {
    await galleryAfter
      .locator("div.rounded-lg.border-dashed")
      .first()
      .getByRole("textbox")
      .first()
      .fill(originalAlt);
    await page.waitForTimeout(2000);
  }

  const fullSave = page.getByRole("button", { name: "전체 저장" }).first();
  const fullSaveEnabled = await fullSave.isEnabled();

  const result = {
    galleryBlockId: galleryBlock.id,
    dbImageCount: imageCount,
    idlePartialSaveEnabled: idleEnabled,
    idlePartialSaveEmphasis: idleEmphasis,
    idleDirtyStatus: idleStatus,
    hintCount,
    autoSaveLabel,
    idleSavePatchCount: idleSavePatch,
    dirtyEmphasis,
    dirtyStatus,
    imageAutoPatchCount: imagePatchCount,
    altInDb,
    altAfterReload,
    fullSaveEnabled
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    idleEnabled &&
    !idleEmphasis &&
    idleStatus === 0 &&
    hintCount === 1 &&
    autoSaveLabel >= 1 &&
    dirtyEmphasis &&
    dirtyStatus >= 1 &&
    imagePatchCount >= 1 &&
    altInDb === testAlt &&
    altAfterReload === testAlt &&
    fullSaveEnabled &&
    imageCount >= 1;

  await browser.close();
  if (!ok) {
    process.exitCode = 1;
    console.error("VERIFY_FAIL");
  } else {
    console.log("VERIFY_OK");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
