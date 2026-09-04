/**
 * 인사이트 네 가지 수정 브라우저 확인
 * npx tsx scripts/verify-insight-four-fixes.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL =
  process.env.SITE_URL ?? websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-insight-four-fixes");

// 콘텐츠 DB 는 웹사이트 프로젝트. 인증은 허브.
const CONTENT_URL = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
const CONTENT_SERVICE =
  websiteEnv.SUPABASE_SECRET_KEY ?? websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
const HUB_URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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
  mkdirSync(OUT, { recursive: true });
  const content = createClient(CONTENT_URL, CONTENT_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const admin = createClient(HUB_URL_SB, HUB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const listed = await content
    .from("insights")
    .select("id, slug, title")
    .order("updated_at", { ascending: false })
    .limit(20);
  console.log("insights list", listed.error?.message ?? null, (listed.data ?? []).length);

  let insight: { id: string; slug: string; title: unknown } | null = null;
  for (const row of listed.data ?? []) {
    const title = JSON.stringify(row.title ?? "");
    if (/롯데|면세|Lotte|lotte/i.test(title) || /lotte|duty/i.test(String(row.slug))) {
      insight = row as { id: string; slug: string; title: unknown };
      break;
    }
  }
  if (!insight) {
    insight = (listed.data?.[0] as { id: string; slug: string; title: unknown } | undefined) ?? null;
  }
  if (!insight) {
    const fixed = await content
      .from("insights")
      .select("id, slug, title")
      .eq("id", "bbdfef0f-ea89-4785-ab9d-916065544b34")
      .maybeSingle();
    insight = (fixed.data as { id: string; slug: string; title: unknown } | null) ?? null;
  }

  if (!insight) throw new Error("insight not found");
  const insightId = insight.id;
  const slug = insight.slug;
  console.log("using insight", insightId, slug, JSON.stringify(insight.title));

  // 본문 이미지
  const { data: blocks } = await content
    .from("insight_blocks")
    .select("id, sort, preset")
    .eq("insight_id", insightId)
    .order("sort");
  const blockIds = (blocks ?? []).map((b) => b.id);
  const { data: images } = await content
    .from("insight_images")
    .select("id, block_id, alt, caption, caption_visible, sort")
    .in("block_id", blockIds.length ? blockIds : ["00000000-0000-0000-0000-000000000000"]);

  const insightImages = images ?? [];
  const img = insightImages[0];
  if (!img) throw new Error("no insight images");

  const altBackup = img.alt;
  const captionVisBackup = img.caption_visible;

  await content
    .from("insight_images")
    .update({ alt: { ko: "", en: "" }, caption_visible: true })
    .eq("id", img.id);

  if (img.caption == null || !(img.caption as { ko?: string })?.ko) {
    await content
      .from("insight_images")
      .update({ caption: { ko: "캡션 표시 확인용", en: "caption check" } })
      .eq("id", img.id);
  }

  const session = await createSession(admin, HUB_ANON, HUB_URL_SB, await pickAdminEmail(admin));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, HUB_URL_SB);

  const report: Record<string, unknown> = {
    insightId,
    slug,
    imageId: img.id,
    blockId: img.block_id
  };

  // —— 1·2: 점검 목록에 위치 문구 + 가기 ——
  await page.goto(`${HUB_URL}/website/insights/${insightId}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForSelector(".insight-blks .blk", { timeout: 60_000 });
  await page.waitForTimeout(2500);

  // 점검 열기
  const checkBtn = page.getByRole("button", { name: /점검/ }).first();
  if (await checkBtn.count()) {
    await checkBtn.click();
    await page.waitForTimeout(500);
  }

  const checkText = await page.locator("body").innerText();
  report.altMessageVisible = /본문\s*\d+번째\s*블록/.test(checkText) && /대체 텍스트/.test(checkText);
  report.altMessageSample = (checkText.match(/본문\s*\d+번째\s*블록[^\n]{0,80}/) ?? [])[0] ?? null;

  const goBtn = page.getByRole("button", { name: "가기" }).first();
  report.hasGo = (await goBtn.count()) > 0;
  if (report.hasGo) {
    await goBtn.click();
    await page.waitForTimeout(800);
    const focused = page.locator(`#insight-block-${img.block_id}`);
    report.goOpenedBlock =
      (await focused.count()) > 0 &&
      ((await focused.getAttribute("class")) ?? "").includes("on");
    await focused.screenshot({ path: resolve(OUT, "01-go-block.png") }).catch(() => null);
  }

  // —— 공개 팝업 실패 시 이유 표시 · 열림 유지 ——
  const publishBtn = page.getByRole("button", { name: /^공개$|공개하기/ }).first();
  if (await publishBtn.count()) {
    await publishBtn.click();
    await page.waitForTimeout(2000);
    // 저장하고 공개 확인 다이얼로그
    const savePub = page.getByRole("button", { name: /저장하고 공개/ });
    if (await savePub.isVisible().catch(() => false)) {
      await savePub.click();
      await page.waitForTimeout(2500);
    }
    const modal = page.locator('[role="dialog"]');
    report.publishModalOpenOnBlocked = await modal.isVisible().catch(() => false);
    if (report.publishModalOpenOnBlocked) {
      const confirm = page.getByRole("button", { name: /공개 확인/ });
      if (await confirm.isEnabled().catch(() => false)) {
        // note 필요할 수 있음
        const note = page.locator("#publish-change-note");
        if (await note.count()) {
          const v = await note.inputValue();
          if (!v.trim()) await note.fill("테스트 공개");
        }
        await confirm.click();
        await page.waitForTimeout(3000);
      }
      const errBox = page.locator('[role="dialog"] .text-rose-700, [role="dialog"] .bg-rose-50');
      report.publishErrorInModal = (await errBox.innerText().catch(() => "")).slice(0, 200);
      report.publishModalStillOpenAfterFail = await modal.isVisible().catch(() => false);
      await page.screenshot({ path: resolve(OUT, "02-publish-fail-modal.png") });
      // 닫기
      const cancel = page.getByRole("button", { name: "취소" }).first();
      if (await cancel.isVisible().catch(() => false)) await cancel.click();
    }
  }

  // —— 3: 대체텍스트 채우고 공개 → 팝업 닫힘 ——
  await content.from("insight_images").update({ alt: altBackup ?? { ko: "복구 대체텍스트", en: "alt" } }).eq("id", img.id);
  // 국문이 비어 있으면 채움
  const ko =
    altBackup && typeof altBackup === "object" && typeof (altBackup as { ko?: string }).ko === "string"
      ? (altBackup as { ko: string }).ko.trim()
      : "";
  if (!ko) {
    await content
      .from("insight_images")
      .update({ alt: { ko: "복구 대체텍스트", en: "restored alt" } })
      .eq("id", img.id);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 캡션 스위치 확인
  const textBlk = page.locator(".insight-blks .blk").filter({ hasText: /전폭|2단|3단|갤러리|이미지/ }).first();
  if ((await textBlk.count()) === 0) {
    await page.locator(".insight-blks .blk .bh").first().click();
  } else {
    if (!(await textBlk.locator(".bb").isVisible().catch(() => false))) {
      await textBlk.locator(".bh").click();
    }
  }
  // 이미지 있는 블록 전부 펼침
  const headers = page.locator(".insight-blks .blk .bh");
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click().catch(() => null);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  report.captionToggleVisible = (await page.getByText("화면에 캡션 표시").count()) > 0;
  await page.screenshot({ path: resolve(OUT, "03-caption-toggle.png"), fullPage: true });

  // 공개 성공 시도 (점검을 통과하는 경우만)
  const publishBtn2 = page.getByRole("button", { name: /^공개$|공개하기/ }).first();
  if (await publishBtn2.count()) {
    await publishBtn2.click();
    await page.waitForTimeout(2000);
    const savePub2 = page.getByRole("button", { name: /저장하고 공개/ });
    if (await savePub2.isVisible().catch(() => false)) {
      await savePub2.click();
      await page.waitForTimeout(3000);
    }
    const modal2 = page.locator('[role="dialog"]');
    if (await modal2.isVisible().catch(() => false)) {
      const note = page.locator("#publish-change-note");
      if (await note.count()) {
        const v = await note.inputValue();
        if (!v.trim()) await note.fill("네 가지 수정 확인 공개");
      }
      const confirm2 = page.getByRole("button", { name: /공개 확인/ });
      if (await confirm2.isEnabled().catch(() => false)) {
        await confirm2.click();
        await page.waitForTimeout(5000);
      }
      report.publishModalClosedAfterSuccess = !(await modal2.isVisible().catch(() => false));
      report.publishErrorAfterSuccessAttempt = await page
        .locator('[role="dialog"] .bg-rose-50')
        .innerText()
        .catch(() => null);
    } else {
      report.publishModalClosedAfterSuccess = true;
    }
  }

  // —— 4: 캡션 스위치 off → 공개 화면에서 캡션 없음 ——
  await content.from("insight_images").update({ caption_visible: false }).eq("id", img.id);
  // 스냅샷에 반영하려면 재공개가 필요 — 미리보기로 확인
  const previewRes = await page.evaluate(async (id) => {
    // 미리보기 토큰이 있는 환경이면
    return id;
  }, insightId);

  await page.goto(`${SITE_URL}/preview/insights/${insightId}?token=${encodeURIComponent(websiteEnv.PREVIEW_SECRET ?? "")}&locale=ko`, {
    waitUntil: "networkidle",
    timeout: 60_000
  }).catch(() => null);
  await page.waitForTimeout(1500);
  const previewBody = await page.locator("body").innerText().catch(() => "");
  report.previewLoaded = previewBody.length > 50 && !/404|not found/i.test(previewBody);
  report.captionHiddenInPreview =
    report.previewLoaded && !previewBody.includes("캡션 표시 확인용");

  // caption_visible true 로 되돌린 뒤 미리보기
  await content.from("insight_images").update({ caption_visible: true }).eq("id", img.id);
  await page.reload({ waitUntil: "networkidle" }).catch(() => null);
  await page.waitForTimeout(1000);
  const previewBody2 = await page.locator("body").innerText().catch(() => "");
  report.captionShownWhenOn = previewBody2.includes("캡션 표시 확인용");

  // —— 5: Related Articles ——
  // 연결이 있는지 확인
  const { data: related } = await content
    .from("content_related")
    .select("*")
    .eq("source_insight_id", insightId)
    .order("sort");
  report.relatedCount = (related ?? []).length;
  report.relatedTypes = (related ?? []).map((r) => r.target_type);

  // 미리보기에서 Related
  report.relatedInPreview = /Related|관련/i.test(previewBody2) || /Related|관련/i.test(previewBody);

  // 공개 페이지 (스냅샷 — 재공개 후)
  await page.goto(`${SITE_URL}/insight/${slug}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1000);
  const publicText = await page.locator("body").innerText();
  report.relatedOnPublic = /Related Articles|Related Article/i.test(publicText);
  await page.screenshot({ path: resolve(OUT, "04-public-related.png"), fullPage: true });

  // 복구
  await content
    .from("insight_images")
    .update({
      alt: altBackup,
      caption_visible: captionVisBackup
    })
    .eq("id", img.id);

  await browser.close();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
