/**
 * 영상 블록 어드민 표시 확인
 * npx tsx scripts/verify-video-block-admin.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "9cb7ef5e-de15-411c-b1ea-561f7f7de13b";
const VIDEO_BLOCK_ID = "4e8601c6-5516-486f-86b0-d6a1085e9586";
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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  let apiBlocks: unknown = null;
  page.on("response", async (res) => {
    if (res.request().method() !== "GET") return;
    if (!res.url().includes(`/api/website/works/${WORK_ID}`)) return;
    try {
      const json = await res.json();
      const sections = (json.data?.work_sections ?? json.work_sections ?? []) as Array<{
        sort: number;
        headline?: { ko?: string };
        content_blocks?: Array<{ id: string; preset: string; video_url?: string | null }>;
      }>;
      apiBlocks = sections.map((s) => ({
        sort: s.sort,
        title: s.headline?.ko,
        blocks: (s.content_blocks ?? []).map((b) => ({
          id: b.id,
          preset: b.preset,
          video_url: b.video_url
        }))
      }));
    } catch {
      /* ignore */
    }
  });

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2000);

  const overviewSection = page.locator(".sec").filter({ hasText: "Overview" }).first();
  const overviewMt = await overviewSection.locator(".mt").innerText().catch(() => "");
  const videoBlock = page.locator(`#content-block-${VIDEO_BLOCK_ID}`);
  const videoBlockCount = await videoBlock.count();
  const videoBlockVisible = videoBlockCount > 0 ? await videoBlock.isVisible() : false;

  await page.getByRole("button", { name: "전체 펼치기" }).click();
  await page.waitForTimeout(800);

  const videoBlockAfterExpand = page.locator(`#content-block-${VIDEO_BLOCK_ID}`);
  const visibleAfterExpand = (await videoBlockAfterExpand.count()) > 0
    ? await videoBlockAfterExpand.isVisible()
    : false;

  if (visibleAfterExpand) {
    if ((await videoBlockAfterExpand.getAttribute("class"))?.includes(" on") === false) {
      await videoBlockAfterExpand.locator(".bh").click();
      await page.waitForTimeout(400);
    }
  }

  const youtubeInput = videoBlockAfterExpand.getByPlaceholder("유튜브 · Vimeo · Behance 주소");
  const youtubeValue = (await youtubeInput.count()) > 0 ? await youtubeInput.inputValue() : null;
  const deleteBtn = videoBlockAfterExpand.locator(".bh .ico").filter({ hasText: "✕" });
  const deleteVisible = (await deleteBtn.count()) > 0 ? await deleteBtn.isVisible() : false;

  const allVideoBlocks = await page.locator(".blk .kd").filter({ hasText: "영상 전폭" }).count();

  const fataBlock = page.locator(`#content-block-4405e7b5-9176-48e7-8b7e-962f99a3913e`);
  const fataVisible = (await fataBlock.count()) > 0 ? await fataBlock.isVisible() : false;

  const result = {
    apiBlocks,
    overviewMt,
    videoBlockCount,
    videoBlockVisible,
    visibleAfterExpand,
    youtubeValue,
    deleteVisible,
    allVideoBlocks,
    fataVisible,
    consoleErrors: consoleErrors.slice(0, 10),
    pageErrors
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    visibleAfterExpand &&
    youtubeValue?.includes("jveaGA1WltQ") &&
    deleteVisible &&
    allVideoBlocks >= 5 &&
    fataVisible;

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
