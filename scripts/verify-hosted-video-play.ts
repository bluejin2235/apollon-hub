/**
 * hosted 영상 가운데 재생 버튼
 * npx tsx scripts/verify-hosted-video-play.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = websiteEnv.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", WORK_ID);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: blocks } = await siteAdmin
    .from("content_blocks")
    .select("id, video_kind, video_url, video_poster, preset")
    .in("section_id", sectionIds)
    .eq("video_kind", "hosted")
    .not("video_url", "is", null)
    .limit(5);

  const hosted = (blocks ?? []).find((b) => Boolean(b.video_url));
  if (!hosted?.video_url) {
    console.log(JSON.stringify({ skipped: true, reason: "no hosted video on work" }, null, 2));
    process.exit(0);
  }

  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  let previewResult: Record<string, unknown> | null = null;
  const previewSecret = process.env.PREVIEW_SECRET?.trim() ?? websiteEnv.PREVIEW_SECRET?.trim();
  if (previewSecret) {
    const previewUrl = `${SITE_URL}/preview/works/${WORK_ID}?token=${encodeURIComponent(previewSecret)}&locale=ko`;
    await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(2500);

    const frame = page.locator(".block-video__frame").filter({ has: page.locator("video[controls]") }).first();
    const frameVisible = await frame.isVisible().catch(() => false);
    if (frameVisible) {
      const playBtn = frame.getByRole("button", { name: "재생" });
      const playVisibleBefore = await playBtn.isVisible();
      const video = frame.locator("video");
      const hasControls = await video.evaluate((el) => (el as HTMLVideoElement).controls);
      await playBtn.click();
      await page.waitForTimeout(800);
      const state = await video.evaluate((el) => {
        const v = el as HTMLVideoElement;
        return {
          paused: v.paused,
          muted: v.muted,
          currentTime: v.currentTime,
        };
      });
      const playVisibleAfter = await playBtn.isVisible().catch(() => false);
      if (!state.paused) {
        await video.evaluate((el) => (el as HTMLVideoElement).pause());
        await page.waitForTimeout(400);
      }
      const playVisiblePaused = await playBtn.isVisible().catch(() => false);
      previewResult = {
        frameVisible,
        playVisibleBefore,
        hasControls,
        playVisibleAfter,
        playVisiblePaused,
        ...state,
      };
    } else {
      previewResult = { frameVisible: false };
    }
  }

  await browser.close();

  const report = {
    hostedBlockId: hosted.id,
    previewSkipped: !previewSecret,
    previewResult,
  };
  console.log("\n=== hosted video play verify ===");
  console.log(JSON.stringify(report, null, 2));

  const ok =
    !previewSecret ||
    (previewResult &&
      previewResult.frameVisible &&
      previewResult.playVisibleBefore &&
      previewResult.hasControls &&
      previewResult.paused === false &&
      previewResult.muted === false &&
      previewResult.playVisibleAfter === false &&
      previewResult.playVisiblePaused === true);

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
