/**
 * stack 블록 — 피커 · 업로드 · 미리보기 · gallery-auto 무손상
 * npx tsx scripts/verify-stack-block.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = websiteEnv.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=content`;

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
  email: string,
): Promise<Session> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session as unknown as Session;
}

async function login(
  context: BrowserContext,
  page: Page,
  session: Session,
  supabaseUrl: string,
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
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, url: HUB_URL, sameSite: "Lax" as const })),
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`,
  );
}

function readBlockLayout(page: import("playwright").Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el);
    const media = el.querySelector<HTMLElement>(".block-gallery-auto__media, .block-stack__media");
    const mediaStyle = media ? getComputedStyle(media) : null;
    const items =
      el.classList.contains("block-stack")
        ? Array.from(el.querySelectorAll<HTMLElement>(".block-stack__media"))
        : [];
    const rects = items.map((item) => item.getBoundingClientRect());
    let verticalGap = 0;
    if (rects.length >= 2) {
      verticalGap = rects[1]!.top - rects[0]!.bottom;
    }
    return {
      flexDirection: style.flexDirection,
      gap: style.gap,
      gapPx: parseFloat(style.gap || style.rowGap || "0"),
      borderRadius: style.borderRadius,
      borderRadiusPx: parseFloat(style.borderTopLeftRadius || "0"),
      overflow: style.overflow,
      verticalGap,
      itemCount: items.length,
      mediaBorderRadius: mediaStyle?.borderRadius ?? null,
    };
  });
}

async function main() {
  const dir = resolve(tmpdir(), `stack-block-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const imgA = resolve(dir, "stack-a.jpg");
  const imgB = resolve(dir, "stack-b.jpg");
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toFile(imgA);
  await sharp({
    create: { width: 1600, height: 800, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toFile(imgB);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });

  const blocksBefore = await page.locator(".blk").count();
  await page.getByRole("button", { name: "＋ 블록 추가" }).first().click();
  await page.getByRole("heading", { name: "블록 추가", level: 2 }).waitFor({ timeout: 30_000 });

  const stackPickerBtn = page.locator("button").filter({ hasText: "위아래 두 장" }).first();
  await stackPickerBtn.waitFor({ state: "visible", timeout: 30_000 });
  const pickerHasStack = await stackPickerBtn.isVisible();
  const pickerDesc = pickerHasStack ? await stackPickerBtn.innerText() : "";
  const rowHeightFieldVisible = await page.getByText("줄 높이").isVisible().catch(() => false);

  const createWait = page.waitForResponse(
    (res) =>
      res.url().includes("/api/website/sections/") &&
      res.url().includes("/blocks") &&
      res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await stackPickerBtn.click();
  const createRes = await createWait;
  const createJson = (await createRes.json()) as { data?: { id?: string } };
  const stackBlockId = createJson.data?.id;
  if (!stackBlockId) throw new Error(`stack block create failed: ${createRes.status()}`);

  await page.waitForTimeout(1500);
  const blocksAfter = await page.locator(".blk").count();

  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);

  const stackBlock = page.locator(`#content-block-${stackBlockId}`);
  await stackBlock.waitFor({ state: "visible", timeout: 30_000 });
  if (!(await stackBlock.getAttribute("class"))?.includes(" on")) {
    await stackBlock.locator(".bh").click();
    await page.waitForTimeout(400);
  }

  const stackRowHeightVisible = await stackBlock.getByText("줄 높이").isVisible().catch(() => false);

  const fileInput = stackBlock.locator('input[type="file"]').first();
  const uploadOne = () =>
    page.waitForResponse(
      (res) => res.url().includes("/api/website/upload") && res.request().method() === "POST",
      { timeout: 120_000 },
    );

  const w1 = uploadOne();
  await fileInput.setInputFiles(imgA);
  const r1 = await w1;
  const w2 = uploadOne();
  await fileInput.setInputFiles(imgB);
  const r2 = await w2;
  await page.waitForTimeout(1500);

  const imagesPanel = stackBlock.locator("div.rounded-lg.border-dashed").first();
  const altFields = imagesPanel.getByRole("textbox");
  const altCount = await altFields.count();
  for (let i = 0; i < Math.min(altCount, 2); i++) {
    await altFields.nth(i).fill(`스택 alt ${i + 1}`);
    await page.waitForTimeout(1800);
  }
  await page.waitForTimeout(2000);

  const { data: dbImages } = await siteAdmin
    .from("block_images")
    .select("id, alt, sort")
    .eq("block_id", stackBlockId)
    .order("sort");
  const savedImageCount = (dbImages ?? []).length;
  const savedAlts = (dbImages ?? []).map((row) => (row.alt as { ko?: string } | null)?.ko ?? "");

  let previewStack: Record<string, unknown> | null = null;
  let previewGallery: Record<string, unknown> | null = null;
  const previewSecret = process.env.PREVIEW_SECRET?.trim() ?? websiteEnv.PREVIEW_SECRET?.trim();
  if (previewSecret) {
    const previewPage = await context.newPage();
    const previewUrl = `${SITE_URL}/preview/works/${WORK_ID}?token=${encodeURIComponent(previewSecret)}&locale=ko`;
    await previewPage.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await previewPage.waitForTimeout(2500);

    const stackVisible = await previewPage.locator(".block-stack").last().isVisible().catch(() => false);
    const galleryVisible = await previewPage
      .locator(".block-gallery-auto")
      .first()
      .isVisible()
      .catch(() => false);

    if (stackVisible) {
      previewStack = await readBlockLayout(previewPage, ".block-stack");
    }
    if (galleryVisible) {
      previewGallery = await readBlockLayout(previewPage, ".block-gallery-auto");
    }
    await previewPage.close();
  }

  await siteAdmin.from("content_blocks").delete().eq("id", stackBlockId);
  await browser.close();
  try {
    unlinkSync(imgA);
    unlinkSync(imgB);
  } catch {
    /* ignore */
  }

  const stackGap = (previewStack?.gapPx as number) ?? 0;
  const galleryGap = (previewGallery?.gapPx as number) ?? 0;
  const gapMatchesGallery =
    previewStack && previewGallery && Math.abs(stackGap - galleryGap) <= 0.5;
  const clipRounding =
    previewStack &&
    (previewStack.borderRadiusPx as number) > 0 &&
    previewStack.overflow === "hidden";
  const stackedOk =
    previewStack?.flexDirection === "column" && (previewStack?.itemCount as number) >= 2;
  const galleryIntact =
    previewGallery &&
    (previewGallery.borderRadiusPx as number) > 0 &&
    previewGallery.overflow === "hidden" &&
    (previewGallery.gapPx as number) > 0;

  const report = {
    pickerHasStack,
    pickerDescIncludes: pickerDesc.includes("가로 이미지를 위아래로 붙여"),
    rowHeightFieldVisible,
    stackRowHeightVisible,
    blockCreateStatus: createRes.status(),
    blocksAdded: blocksAfter > blocksBefore,
    uploadOk: r1.status() === 200 && r2.status() === 200,
    savedImageCount,
    savedAlts,
    previewStack,
    previewGallery,
    checks: { gapMatchesGallery, clipRounding, stackedOk, galleryIntact },
    previewSkipped: !previewSecret,
  };

  console.log("\n=== stack block verify ===");
  console.log(JSON.stringify(report, null, 2));

  const ok =
    pickerHasStack &&
    pickerDesc.includes("가로 이미지를 위아래로 붙여") &&
    !rowHeightFieldVisible &&
    !stackRowHeightVisible &&
    createRes.status() === 201 &&
    blocksAfter > blocksBefore &&
    r1.status() === 200 &&
    r2.status() === 200 &&
    savedImageCount >= 2 &&
    savedAlts.filter(Boolean).length >= 2 &&
    (!previewSecret ||
      (stackedOk && gapMatchesGallery && clipRounding && galleryIntact));

  if (!ok) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
