/**
 * 이미지 업로드 점검
 * npx tsx scripts/verify-image-upload.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomFillSync, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = (process.env.WEBSITE_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const WORK_ID = process.env.VERIFY_WORK_ID ?? "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=basic`;

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
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .limit(1);
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

async function makeNoiseJpeg(width: number, height: number, quality: number) {
  const raw = Buffer.alloc(width * height * 3);
  randomFillSync(raw);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

function adminHeaders() {
  const secret = process.env.ADMIN_API_SECRET?.trim() || process.env.WEBSITE_ADMIN_SECRET?.trim();
  if (!secret) throw new Error("no admin secret");
  return { Authorization: `Bearer ${secret}` };
}

async function main() {
  const report: Record<string, unknown> = {};
  const dir = resolve(tmpdir(), `img-up-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const bigName = "0224pwj_0109 1 복사 4.jpg";
  const smallName = "작은 1200.jpg";
  const bigPath = resolve(dir, bigName);
  const smallPath = resolve(dir, smallName);

  let big = await makeNoiseJpeg(5000, 3348, 95);
  if (big.length < 20 * 1024 * 1024) {
    big = await makeNoiseJpeg(6000, 4000, 100);
  }
  if (big.length < 20 * 1024 * 1024) {
    const raw = Buffer.alloc(5600 * 3600 * 3);
    randomFillSync(raw);
    big = await sharp(raw, { raw: { width: 5600, height: 3600, channels: 3 } }).png().toBuffer();
  }
  const small = await makeNoiseJpeg(1200, 800, 85);
  writeFileSync(bigPath, big);
  writeFileSync(smallPath, small);
  report.generated = {
    big: { path: bigName, bytes: big.length, mb: Number((big.length / (1024 * 1024)).toFixed(1)) },
    small: { path: smallName, bytes: small.length },
  };
  console.log("generated", JSON.stringify(report.generated));

  const headers = adminHeaders();
  const originalWork = (await (
    await fetch(`${SITE_URL}/api/admin/works/${WORK_ID}`, { headers })
  ).json()) as {
    data?: {
      key_image?: string | null;
      key_image_width?: number | null;
      key_image_height?: number | null;
    };
  };
  const originalKey = {
    key_image: originalWork.data?.key_image ?? null,
    key_image_width: originalWork.data?.key_image_width ?? null,
    key_image_height: originalWork.data?.key_image_height ?? null,
  };
  const bigFile = new File([new Uint8Array(big)], bigName, { type: "image/jpeg" });
  const form = new FormData();
  form.append("file", bigFile);
  form.append("bucket", "works");
  form.append("path", `verify/${WORK_ID}/key/${bigName}`);
  form.append("role", "key");
  const up = await fetch(`${SITE_URL}/api/admin/upload`, { method: "POST", headers, body: form });
  const upJson = (await up.json()) as {
    error?: string;
    details?: { message?: string };
    data?: { path: string; width: number; height: number; size: number; mime: string };
  };
  report.serverDirect = {
    status: up.status,
    error: upJson.error ?? null,
    data: upJson.data
      ? {
          path: upJson.data.path,
          width: upJson.data.width,
          height: upJson.data.height,
          size: upJson.data.size,
          mime: upJson.data.mime,
          longEdge: Math.max(upJson.data.width, upJson.data.height),
          safeName: /^i[a-z0-9]+\.(jpg|jpeg|png|webp|avif|gif)$/i.test(
            upJson.data.path.split("/").pop() ?? "",
          ),
        }
      : null,
  };
  console.log("serverDirect", JSON.stringify(report.serverDirect));

  const smallForm = new FormData();
  smallForm.append("file", new File([new Uint8Array(small)], smallName, { type: "image/jpeg" }));
  smallForm.append("bucket", "works");
  smallForm.append("path", `verify/${WORK_ID}/key/${smallName}`);
  smallForm.append("role", "key");
  const smallUp = await fetch(`${SITE_URL}/api/admin/upload`, {
    method: "POST",
    headers,
    body: smallForm,
  });
  const smallJson = (await smallUp.json()) as {
    error?: string;
    details?: { message?: string; width?: number; height?: number };
  };
  report.serverSmall = {
    status: smallUp.status,
    error: smallJson.error ?? null,
    message: smallJson.details?.message ?? null,
  };
  console.log("serverSmall", JSON.stringify(report.serverSmall));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByText("대표 이미지", { exact: false }).first().waitFor({ timeout: 60_000 });

  const keyInput = page.locator('input[type="file"][accept*="image"]').first();
  await keyInput.setInputFiles(smallPath);
  const rejectText = page.getByText("긴 변이 1600 이상이어야 합니다. 지금 1200×800 입니다");
  await rejectText.waitFor({ timeout: 20_000 });
  report.uiSmall = {
    visible: await rejectText.isVisible(),
    text: (await rejectText.textContent())?.trim() ?? null,
  };

  const uploadBodies: Array<{ status: number; body: unknown; url: string }> = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/website/upload")) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    uploadBodies.push({ status: res.status(), body, url: res.url() });
  });

  await keyInput.setInputFiles(bigPath);
  const shrink = page.getByText("줄이는 중");
  const uploading = page.getByText("올리는 중");
  report.uiProgress = {
    shrink: await shrink.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false),
  };
  report.uiProgress = {
    ...((report.uiProgress as object) ?? {}),
    uploading: await uploading.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false),
  };
  await page.getByText("올렸습니다").waitFor({ timeout: 180_000 }).catch(() => null);
  await page.waitForTimeout(1500);
  report.uiBig = {
    uploads: uploadBodies,
    nowText: await page.locator(".spec .now").first().textContent().catch(() => null),
    fileName: await page.locator(".filecard .fn").first().textContent().catch(() => null),
  };

  await browser.close();

  await fetch(`${SITE_URL}/api/admin/works/${WORK_ID}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(originalKey),
  }).catch(() => null);

  try {
    unlinkSync(bigPath);
    unlinkSync(smallPath);
  } catch {
    /* ignore */
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
