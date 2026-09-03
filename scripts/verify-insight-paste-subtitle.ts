/**
 * 인사이트 붙여넣기 살균 · 부제 줄바꿈
 * npx tsx scripts/verify-insight-paste-subtitle.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL =
  process.env.SITE_URL ?? websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const INSIGHT_SLUG = "insight-1788401143052";

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
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK),
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
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: insight } = await siteAdmin
    .from("insights")
    .select("id, slug, subtitle")
    .eq("slug", INSIGHT_SLUG)
    .maybeSingle();
  if (!insight) throw new Error("insight not found");
  const insightId = insight.id as string;

  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  const editorUrl = `${HUB_URL}/website/insights/${insightId}?tab=content`;
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);

  const editor = page.locator('[contenteditable="true"]').first();
  const editorVisible = await editor.isVisible().catch(() => false);
  let pasteResult: Record<string, unknown> = { editorVisible };

  if (editorVisible) {
    // 자동저장으로 본문이 덮이지 않도록, 붙여넣기 전 스냅샷을 확보하고 끝나면 되돌린다.
    const { data: blockSnap } = await siteAdmin
      .from("insight_blocks")
      .select("id, body")
      .eq("insight_id", insightId)
      .eq("preset", "text")
      .order("sort")
      .limit(1)
      .maybeSingle();

    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);

    const dirtyHtml =
      '<p style="margin: -10px 0px 30px; color: rgb(28,28,28); font-size: 18px; font-family: Pretendard Variable, sans-serif;">붙여넣기검증 <b style="font-weight:700">굵게</b> <span style="color:#b0231e">강조색</span></p>';

    await page.evaluate(async ({ html, text }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    }, { html: dirtyHtml, text: "붙여넣기검증 굵게 강조색" });

    await page.keyboard.press("Control+v");
    await page.waitForTimeout(1000);

    const htmlAfter = await editor.innerHTML();
    const toastVisible = await page.getByText("서식을 걸러 넣었습니다").isVisible().catch(() => false);
    pasteResult = {
      editorVisible,
      htmlAfter,
      toastVisible,
      hasFontFamily: /font-family/i.test(htmlAfter),
      hasRgbColor: /rgb\(28/i.test(htmlAfter),
      hasPlainText: htmlAfter.includes("붙여넣기검증"),
      hasBold: /굵게/.test(htmlAfter),
      hasColorKeep: /style="color:#b0231e"/i.test(htmlAfter),
      hasPlainPasteBtn: (await page.getByRole("button", { name: "글자만 붙여넣기" }).count()) > 0,
    };

    if (blockSnap?.id && blockSnap.body) {
      await siteAdmin
        .from("insight_blocks")
        .update({ body: blockSnap.body })
        .eq("id", blockSnap.id);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    }
  }

  const publicUrl = `${SITE_URL}/insight/${INSIGHT_SLUG}?_ts=${Date.now()}`;
  await page.goto(publicUrl, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1500);
  let subtitle = page.locator(".insight-detail__subtitle");
  if (!(await subtitle.isVisible().catch(() => false))) {
    await page.goto(`${SITE_URL}/ko/insight/${INSIGHT_SLUG}?_ts=${Date.now()}`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });
    await page.waitForTimeout(1500);
    subtitle = page.locator(".insight-detail__subtitle");
  }
  const subtitleHtml = (await subtitle.innerHTML().catch(() => "")) || "";
  const brCount = (subtitleHtml.match(/<br\s*\/?>/gi) ?? []).length;
  const publicOk = brCount >= 1 && subtitleHtml.length > 0;

  await browser.close();

  const report = { pasteResult, public: { url: publicUrl, subtitleHtml, brCount, publicOk } };
  console.log("\n=== insight paste + subtitle verify ===");
  console.log(JSON.stringify(report, null, 2));

  const pasteOk =
    Boolean(pasteResult.editorVisible) &&
    Boolean(pasteResult.toastVisible) &&
    Boolean(pasteResult.hasPlainText) &&
    Boolean(pasteResult.hasBold) &&
    Boolean(pasteResult.hasColorKeep) &&
    !pasteResult.hasFontFamily &&
    !pasteResult.hasRgbColor &&
    Boolean(pasteResult.hasPlainPasteBtn);

  if (!pasteOk || !publicOk) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
