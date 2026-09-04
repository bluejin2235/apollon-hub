/**
 * SKIP_PUBLISH_CHECK=true 반영 확인
 * · 하단 「개발 중 · 점검을 건너뛰고…」
 * · 점검 걸린 워크 공개 가능
 * npx tsx scripts/verify-skip-publish-check.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

async function main() {
  const report: Record<string, unknown> = {
    envHub: process.env.NEXT_PUBLIC_SKIP_PUBLISH_CHECK,
    envSite: websiteEnv.NEXT_PUBLIC_SKIP_PUBLISH_CHECK
  };

  const content = createClient(CONTENT_URL, CONTENT_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const hub = createClient(HUB_SB, HUB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Prefer a work already failing checks; else clear key_image_alt temporarily
  const { data: checks } = await content
    .from("check_works")
    .select("id, missing_key_alt, missing_image_alt, no_key_image, ai_unconfirmed")
    .limit(40);
  let workId =
    (checks ?? []).find(
      (c) =>
        c.missing_key_alt || c.missing_image_alt || c.no_key_image || c.ai_unconfirmed
    )?.id ?? null;

  let clearedKeyAlt = false;
  let keyAltBackup: unknown = null;
  if (!workId) {
    const { data: works } = await content
      .from("works")
      .select("id, key_image_alt")
      .eq("status", "published")
      .limit(1);
    workId = works?.[0]?.id ?? null;
    if (!workId) throw new Error("no work");
    keyAltBackup = works?.[0]?.key_image_alt ?? null;
    await content.from("works").update({ key_image_alt: { ko: "", en: "" } }).eq("id", workId);
    clearedKeyAlt = true;
  }
  report.workId = workId;
  report.clearedKeyAlt = clearedKeyAlt;

  const session = await createSession(hub, HUB_ANON, HUB_SB, await pickAdminEmail(hub));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, HUB_SB);

  await page.goto(`${HUB_URL}/website/works/${workId}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(4500);

  const body = await page.locator("body").innerText();
  report.skipBannerVisible = body.includes("개발 중 · 점검을 건너뛰고 공개할 수 있습니다");
  report.publishEnabled = await page
    .getByRole("button", { name: /^공개$/ })
    .first()
    .isEnabled()
    .catch(() => false);

  // open publish and confirm
  await page.getByRole("button", { name: /^공개$/ }).first().click({ force: true });
  await page.waitForTimeout(1200);
  const savePub = page.getByRole("button", { name: /저장하고 공개/ });
  if (await savePub.isVisible().catch(() => false)) {
    await savePub.click();
    await page.waitForTimeout(2500);
  }
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator("#publish-modal-title") });
  await dialog.waitFor({ state: "visible", timeout: 45_000 });
  report.modalSkipWarning = (await dialog.innerText()).includes(
    "점검을 통과하지 못한 상태로 공개합니다"
  );
  const note = dialog.locator("#publish-change-note");
  if (!(await note.inputValue()).trim()) await note.fill("SKIP_PUBLISH_CHECK 검증 공개");
  await dialog.getByRole("button", { name: /공개 확인/ }).click();
  await page.waitForTimeout(12000);

  report.modalClosedAfterPublish = !(await dialog.isVisible().catch(() => false));
  const after = await page.locator("body").innerText();
  report.toastOrLive =
    after.includes("공개되었습니다") || /공개/.test(after.slice(0, 800));

  if (clearedKeyAlt && keyAltBackup != null) {
    await content.from("works").update({ key_image_alt: keyAltBackup }).eq("id", workId);
  } else if (clearedKeyAlt) {
    await content
      .from("works")
      .update({ key_image_alt: { ko: "복구 대체텍스트", en: "restored alt" } })
      .eq("id", workId);
  }

  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const ok =
    report.envHub === "true" &&
    report.envSite === "true" &&
    report.skipBannerVisible === true &&
    report.publishEnabled === true &&
    report.modalClosedAfterPublish === true;
  if (!ok) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
