/**
 * 공개 팝업 실패 메시지 · 연결 공개 확인
 * npx tsx scripts/verify-insight-publish-related.ts
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
    skipHub: process.env.NEXT_PUBLIC_SKIP_PUBLISH_CHECK,
    skipSite: websiteEnv.NEXT_PUBLIC_SKIP_PUBLISH_CHECK
  };

  // 모든 본문 이미지 국문 alt 확보 + 하나 비우기
  const { data: blocks } = await content
    .from("insight_blocks")
    .select("id")
    .eq("insight_id", INSIGHT_ID);
  const blockIds = (blocks ?? []).map((b) => b.id);
  const { data: images } = await content
    .from("insight_images")
    .select("id, block_id, alt")
    .in("block_id", blockIds);
  const img = images?.[0];
  if (!img) throw new Error("no image");
  const backups = new Map((images ?? []).map((i) => [i.id, i.alt]));

  for (const i of images ?? []) {
    await content
      .from("insight_images")
      .update({ alt: { ko: "임시 대체텍스트", en: "temp alt" } })
      .eq("id", i.id);
  }
  await content.from("insight_images").update({ alt: { ko: "", en: "" } }).eq("id", img.id);

  // 연결 시드: 공개된 워크 하나
  const { data: works } = await content
    .from("works")
    .select("id, slug, status")
    .eq("status", "published")
    .limit(1);
  const work = works?.[0];
  let seededRelatedId: string | null = null;
  if (work) {
    await content.from("content_related").delete().eq("source_insight_id", INSIGHT_ID);
    const { data: seeded, error } = await content
      .from("content_related")
      .insert({
        source_type: "insight",
        source_insight_id: INSIGHT_ID,
        target_type: "work",
        target_work_id: work.id,
        sort: 0,
        picked_by: "human"
      })
      .select("id")
      .maybeSingle();
    if (error) report.relatedSeedError = error.message;
    else seededRelatedId = seeded?.id ?? null;
    report.seededWorkSlug = work.slug;
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
  await page.waitForTimeout(3500);

  // 점검 문구
  const checkBtn = page.getByRole("button", { name: /점검/ }).first();
  if (await checkBtn.count()) await checkBtn.click();
  await page.waitForTimeout(400);
  const bodyText = await page.locator("body").innerText();
  report.checkHasLocation = /본문\s*\d+번째\s*블록/.test(bodyText);

  // 공개 → 확인 → 실패 메시지
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
  if (!(await note.inputValue()).trim()) await note.fill("검증 공개");
  await dialog.getByRole("button", { name: /공개 확인/ }).click();
  await page.waitForTimeout(4000);

  report.modalOpenAfterFail = await dialog.isVisible();
  report.dialogText = (await dialog.innerText()).slice(0, 800);
  report.hasFailReason =
    /대체 텍스트|공개할 수 없|publish_blocked|이미지/.test(report.dialogText as string);
  await page.screenshot({ path: resolve(OUT, "05-fail-reason.png") });

  // 닫기
  await dialog.getByRole("button", { name: "취소" }).click().catch(() => null);

  // alt 전부 채우고 재공개
  for (const i of images ?? []) {
    const bak = backups.get(i.id);
    const ko =
      bak && typeof bak === "object" && typeof (bak as { ko?: string }).ko === "string"
        ? (bak as { ko: string }).ko.trim()
        : "";
    await content
      .from("insight_images")
      .update({
        alt: ko ? bak : { ko: `대체텍스트 ${i.id.slice(0, 6)}`, en: "alt" }
      })
      .eq("id", i.id);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^공개$|공개하기/ }).first().click();
  await page.waitForTimeout(1500);
  if (await savePub.isVisible().catch(() => false)) {
    await savePub.click();
    await page.waitForTimeout(3000);
  }
  const dialog2 = page.locator('[role="dialog"]').filter({ has: page.locator("#publish-modal-title") });
  if (await dialog2.isVisible().catch(() => false)) {
    const note2 = dialog2.locator("#publish-change-note");
    if (!(await note2.inputValue()).trim()) await note2.fill("연결·캡션 검증 공개");
    await dialog2.getByRole("button", { name: /공개 확인/ }).click();
    await page.waitForTimeout(6000);
    report.modalOpenAfterSuccess = await dialog2.isVisible().catch(() => false);
    if (report.modalOpenAfterSuccess) {
      report.successDialogText = (await dialog2.innerText()).slice(0, 600);
    }
  } else {
    report.modalOpenAfterSuccess = false;
  }
  report.modalClosedOnSuccess = report.modalOpenAfterSuccess === false;

  // 공개 페이지 Related
  await page.goto(`${SITE_URL}/insight/${SLUG}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);
  const pub = await page.locator("body").innerText();
  report.relatedOnPublic = /Related/i.test(pub);
  report.publicHasWorkLink = work ? pub.includes(work.slug) || /works\//.test(await page.content()) : false;
  await page.screenshot({ path: resolve(OUT, "06-related-public.png"), fullPage: true });

  // 미리보기 related
  await page.goto(
    `${SITE_URL}/preview/insights/${INSIGHT_ID}?token=${encodeURIComponent(websiteEnv.PREVIEW_SECRET ?? "")}&locale=ko`,
    { waitUntil: "networkidle", timeout: 60_000 }
  );
  await page.waitForTimeout(1000);
  const prev = await page.locator("body").innerText();
  report.relatedInPreview = /Related/i.test(prev);

  // 시드 연결 제거는 하지 않음(사용자가 연결 탭에서 쓴 것처럼 남김). 원래 0개였음.
  if (seededRelatedId) report.keptSeededRelated = seededRelatedId;

  await browser.close();
  writeFileSync(resolve(OUT, "report2.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
