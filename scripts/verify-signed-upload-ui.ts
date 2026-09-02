/**
 * 브라우저에서 서명 업로드 · 진행률 · PATCH
 * npx tsx scripts/verify-signed-upload-ui.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "9cb7ef5e-de15-411c-b1ea-561f7f7de13b";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=content`;
const TARGET_MB = 35;

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

function makeMp4(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.write("    ftypisom", 0, "ascii");
  buf[0] = 0;
  buf[1] = 0;
  buf[2] = 0;
  buf[3] = 20;
  return buf;
}

async function main() {
  const dir = resolve(tmpdir(), `signed-ui-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const mp4Path = resolve(dir, "verify-35mb.mp4");
  writeFileSync(mp4Path, makeMp4(TARGET_MB * 1024 * 1024));

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
  const hubHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", WORK_ID)
    .order("sort", { ascending: true })
    .limit(1);
  const sectionId = sections?.[0]?.id;
  if (!sectionId) throw new Error("no section");

  const created = await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks`, {
    method: "POST",
    headers: hubHeaders,
    body: JSON.stringify({
      preset: "video-full",
      sort: 999,
      video_kind: "hosted",
      video_url: "/verify/placeholder.mp4"
    })
  });
  const createdJson = (await created.json()) as { data?: { id?: string } };
  const blockId = createdJson.data?.id;
  if (!blockId) throw new Error("block create failed");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const net: Array<{ url: string; method: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/upload/signed") || url.includes("/object/upload/sign") || url.includes("/storage/v1/object")) {
      net.push({ url: url.split("?")[0] ?? url, method: res.request().method(), status: res.status() });
    }
  });

  const progressSeen: string[] = [];
  const progressWatch = page.locator("text=/올리는 중/");

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);

  const videoBlock = page.locator(`#content-block-${blockId}`);
  await videoBlock.waitFor({ state: "visible", timeout: 30_000 });
  if (!(await videoBlock.getAttribute("class"))?.includes(" on")) {
    await videoBlock.locator(".bh").click();
  }

  const mp4Input = videoBlock.locator('input[type="file"]').first();
  const started = Date.now();
  const signedWait = page.waitForResponse(
    (res) => res.url().includes("/upload/signed") && res.request().method() === "POST",
    { timeout: 30_000 }
  );
  const putWait = page.waitForResponse(
    (res) => res.url().includes("/object/upload/sign") && res.request().method() === "PUT",
    { timeout: 180_000 }
  );

  await mp4Input.setInputFiles(mp4Path);
  const signedRes = await signedWait;
  const watch = setInterval(() => {
    void progressWatch
      .first()
      .innerText()
      .then((t) => {
        if (t && !progressSeen.includes(t)) progressSeen.push(t);
      })
      .catch(() => undefined);
  }, 80);
  const putRes = await putWait;
  clearInterval(watch);
  const ms = Date.now() - started;

  await page.waitForTimeout(2500);
  const videoSrc = await videoBlock.locator("video").first().getAttribute("src").catch(() => null);
  const errorText = await videoBlock.locator(".text-rose-900, .text-rose-800").first().innerText().catch(() => null);

  const { data: blk } = await siteAdmin
    .from("content_blocks")
    .select("video_url, video_kind")
    .eq("id", blockId)
    .maybeSingle();

  await browser.close();
  await fetch(`${HUB_URL}/api/website/sections/${sectionId}/blocks/${blockId}`, {
    method: "DELETE",
    headers: hubHeaders
  });
  try {
    unlinkSync(mp4Path);
  } catch {
    /* ignore */
  }

  const report = {
    signedStatus: signedRes.status(),
    putStatus: putRes.status(),
    putHost: new URL(putRes.url()).host,
    putViaOurServer: putRes.url().includes("/api/website/upload") && !putRes.url().includes("signed"),
    progressSeen,
    seconds: Number((ms / 1000).toFixed(2)),
    videoSrc,
    errorText,
    db: blk,
    net
  };
  console.log(JSON.stringify(report, null, 2));

  const ok =
    signedRes.status() === 200 &&
    putRes.status() >= 200 &&
    putRes.status() < 300 &&
    !report.putViaOurServer &&
    blk?.video_kind === "hosted" &&
    Boolean(blk.video_url && blk.video_url.includes("supabase"));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
