/**
 * skip=true 환경: 공개 성공 시 팝업 닫힘 · Related 표시
 * npx tsx scripts/verify-insight-related-success.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-insight-four-fixes");
const INSIGHT_ID = "ed2cba6a-ade7-4f14-be32-980f0a813aef";
const SLUG = "apollon-immersive-works-renews-star-avenue-lotte-duty-free";

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
  mkdirSync(OUT, { recursive: true });
  const content = createClient(CONTENT_URL, CONTENT_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const hub = createClient(HUB_SB, HUB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const report: Record<string, unknown> = {
    skip: websiteEnv.NEXT_PUBLIC_SKIP_PUBLISH_CHECK
  };

  // alt 전부 채움
  const { data: blocks } = await content
    .from("insight_blocks")
    .select("id")
    .eq("insight_id", INSIGHT_ID);
  const blockIds = (blocks ?? []).map((b) => b.id);
  const { data: images } = await content
    .from("insight_images")
    .select("id, alt")
    .in("block_id", blockIds);
  for (const i of images ?? []) {
    const alt = i.alt as { ko?: string } | null;
    if (!alt?.ko?.trim()) {
      await content
        .from("insight_images")
        .update({ alt: { ko: "대체텍스트", en: "alt" } })
        .eq("id", i.id);
    }
  }

  // 연결 시드
  const { data: works } = await content
    .from("works")
    .select("id, slug")
    .eq("status", "published")
    .limit(1);
  const work = works?.[0];
  if (work) {
    await content.from("content_related").delete().eq("source_insight_id", INSIGHT_ID);
    await content.from("content_related").insert({
      source_type: "insight",
      source_insight_id: INSIGHT_ID,
      target_type: "work",
      target_work_id: work.id,
      sort: 0,
      picked_by: "human"
    });
    report.seededWork = work.slug;
  }

  const session = await createSession(hub, HUB_ANON, HUB_SB, await pickAdminEmail(hub));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, HUB_SB);

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(3000);

  await page.getByRole("button", { name: /^공개$|공개하기/ }).first().click();
  await page.waitForTimeout(1500);
  const savePub = page.getByRole("button", { name: /저장하고 공개/ });
  if (await savePub.isVisible().catch(() => false)) {
    await savePub.click();
    await page.waitForTimeout(3000);
  }

  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator("#publish-modal-title") });
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  const note = dialog.locator("#publish-change-note");
  if (!(await note.inputValue()).trim()) await note.fill("Related Articles 검증 공개");
  await dialog.getByRole("button", { name: /공개 확인/ }).click();
  await page.waitForTimeout(8000);

  report.modalClosedOnSuccess = !(await dialog.isVisible().catch(() => false));
  await page.screenshot({ path: resolve(OUT, "07-after-publish.png") });

  // 미리보기 Related (원본)
  await page.goto(
    `${SITE_URL}/preview/insights/${INSIGHT_ID}?token=${encodeURIComponent(websiteEnv.PREVIEW_SECRET ?? "")}&locale=ko`,
    { waitUntil: "networkidle", timeout: 90_000 }
  );
  await page.waitForTimeout(1200);
  const prevHtml = await page.content();
  const prevText = await page.locator("body").innerText();
  report.relatedInPreview = /Related/i.test(prevText);
  report.previewHasWorkHref = work ? prevHtml.includes(`/works/${work.slug}`) : false;
  await page.screenshot({ path: resolve(OUT, "08-preview-related.png"), fullPage: true });

  // 공개 페이지 Related (새 스냅샷)
  await page.goto(`${SITE_URL}/insight/${SLUG}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);
  const pubHtml = await page.content();
  const pubText = await page.locator("body").innerText();
  report.relatedOnPublic = /Related/i.test(pubText);
  report.publicHasWorkHref = work ? pubHtml.includes(`/works/${work.slug}`) : false;
  await page.screenshot({ path: resolve(OUT, "09-public-related.png"), fullPage: true });

  await browser.close();
  writeFileSync(resolve(OUT, "report-success.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
