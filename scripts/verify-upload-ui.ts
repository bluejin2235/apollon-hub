/**
 * hub UI — 전폭 GIF · 영상 MP4 업로드 · Storage/DB · GIF 애니메이션
 * npx tsx scripts/verify-upload-ui.ts
 */
import { config, parse } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "9cb7ef5e-de15-411c-b1ea-561f7f7de13b";
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

function makeMp4(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.write("ftyp", 4);
  buf.write("isom", 8);
  randomBytes(Math.min(sizeBytes - 12, 4096)).copy(buf, 12);
  return buf;
}

async function main() {
  const dir = resolve(tmpdir(), `upload-ui-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const gifPath = resolve(dir, "verify-animated.gif");
  const mp4Path = resolve(dir, "verify-video.mp4");

  const gifBuf = await sharp({
    create: { width: 1920, height: 1080, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } }
  })
    .gif()
    .toBuffer();
  writeFileSync(gifPath, gifBuf);
  writeFileSync(mp4Path, makeMp4(12 * 1024 * 1024));

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
  const token = session.access_token;

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", WORK_ID)
    .order("sort", { ascending: true })
    .limit(1);
  const sectionId = sections?.[0]?.id;
  if (!sectionId) throw new Error("no section");

  const uploadResponses: Array<{ status: number; error?: string; path?: string }> = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on("response", async (res) => {
    if (!res.url().includes("/api/website/upload")) return;
    try {
      const body = (await res.json()) as {
        error?: string;
        data?: { path?: string; mime?: string };
      };
      uploadResponses.push({
        status: res.status(),
        error: body.error,
        path: body.data?.path
      });
    } catch {
      uploadResponses.push({ status: res.status() });
    }
  });

  const hubHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  async function hubPost(path: string, body: unknown) {
    const res = await fetch(`${HUB_URL}/api/website/${path}`, {
      method: "POST",
      headers: hubHeaders,
      body: JSON.stringify(body)
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  const fullCreated = await hubPost(`sections/${sectionId}/blocks`, {
    preset: "full",
    sort: 998
  });
  const fullBlockId = (fullCreated.json as { data?: { id?: string } })?.data?.id;
  if (!fullBlockId) throw new Error(`full block create failed: ${JSON.stringify(fullCreated)}`);

  const videoCreated = await hubPost(`sections/${sectionId}/blocks`, {
    preset: "video-full",
    sort: 999,
    video_kind: "hosted",
    video_url: "/verify/placeholder.mp4"
  });
  const videoBlockId = (videoCreated.json as { data?: { id?: string } })?.data?.id;
  if (!videoBlockId) throw new Error(`video block create failed: ${JSON.stringify(videoCreated)}`);

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);

  const fullBlock = page.locator(`#content-block-${fullBlockId}`);
  await fullBlock.waitFor({ state: "visible", timeout: 30_000 });
  if (!(await fullBlock.getAttribute("class"))?.includes(" on")) {
    await fullBlock.locator(".bh").click();
  }
  const gifInput = fullBlock.locator('input[type="file"]').first();
  const gifUploadWait = page.waitForResponse(
    (res) => res.url().includes("/api/website/upload") && res.request().method() === "POST",
    { timeout: 120_000 }
  );
  await gifInput.setInputFiles(gifPath);
  const gifRes = await gifUploadWait;
  const gifUploadOk = gifRes.status() === 200;

  const videoBlock = page.locator(`#content-block-${videoBlockId}`);
  await videoBlock.waitFor({ state: "visible", timeout: 30_000 });
  if (!(await videoBlock.getAttribute("class"))?.includes(" on")) {
    await videoBlock.locator(".bh").click();
  }
  const mp4Input = videoBlock.locator('input[type="file"]').first();
  const mp4UploadWait = page.waitForResponse(
    (res) => res.url().includes("/api/website/upload") && res.request().method() === "POST",
    { timeout: 180_000 }
  );
  await mp4Input.setInputFiles(mp4Path);
  const mp4Res = await mp4UploadWait;
  const mp4UploadOk = mp4Res.status() === 200;
  await page.waitForTimeout(4000);

  // DB 확인
  let gifDb = null;
  let mp4Db = null;
  if (fullBlockId) {
    const { data: imgs } = await siteAdmin
      .from("block_images")
      .select("src, width, height")
      .eq("block_id", fullBlockId)
      .limit(1);
    gifDb = imgs?.[0] ?? null;
  }
  if (videoBlockId) {
    const { data: blk } = await siteAdmin
      .from("content_blocks")
      .select("video_url, video_kind")
      .eq("id", videoBlockId)
      .maybeSingle();
    mp4Db = blk;
  }

  // Storage 확인
  const gifUpload = uploadResponses.find((u) => u.path?.endsWith(".gif"));
  const mp4Upload = uploadResponses.find((u) => u.path?.endsWith(".mp4"));
  let gifStorageOk = false;
  let mp4StorageOk = false;
  if (gifUpload?.path) {
    const { data } = await siteAdmin.storage.from("works").download(gifUpload.path);
    gifStorageOk = !!data && data.size > 0;
  }
  if (mp4Upload?.path) {
    const { data } = await siteAdmin.storage.from("works").download(mp4Upload.path);
    mp4StorageOk = !!data && data.size > 10 * 1024 * 1024;
  }

  // 공개 페이지 GIF 애니메이션 (img src ends with .gif)
  const workSlug = "trendyyouth-town";
  const publicPage = await context.newPage();
  await publicPage.goto(`http://localhost:3100/ko/works/${workSlug}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  const gifImg = publicPage.locator('img[src*=".gif"]').first();
  const gifVisible = await gifImg.isVisible().catch(() => false);
  const gifSrc = gifVisible ? await gifImg.getAttribute("src") : null;

  await browser.close();

  // cleanup blocks
  if (fullBlockId) {
    await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks/${fullBlockId}`, {
      method: "DELETE",
      headers: hubHeaders
    });
  }
  if (videoBlockId) {
    await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks/${videoBlockId}`, {
      method: "DELETE",
      headers: hubHeaders
    });
  }

  try {
    unlinkSync(gifPath);
    unlinkSync(mp4Path);
  } catch {
    /* ignore */
  }

  const report = {
    uploads: uploadResponses,
    gif: {
      uploadOk: gifUploadOk && uploadResponses.some((u) => u.status === 200 && u.path?.endsWith(".gif")),
      db: gifDb,
      storageOk: gifStorageOk,
      blockId: fullBlockId
    },
    mp4: {
      uploadOk: mp4UploadOk && uploadResponses.some((u) => u.status === 200 && u.path?.endsWith(".mp4")),
      db: mp4Db,
      storageOk: mp4StorageOk,
      blockId: videoBlockId,
      sizeMB: 12
    },
    publicGif: { visible: gifVisible, src: gifSrc }
  };

  console.log(JSON.stringify(report, null, 2));

  const ok =
    report.gif.uploadOk &&
    report.mp4.uploadOk &&
    report.gif.storageOk &&
    report.mp4.storageOk &&
    !!report.gif.db?.src &&
    report.mp4.db?.video_kind === "hosted";

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
