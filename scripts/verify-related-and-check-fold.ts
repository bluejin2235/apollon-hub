/**
 * 점검 목록 접기 · 연결 탭 루나/직접 고르기
 * npx tsx scripts/verify-related-and-check-fold.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = (process.env.WEBSITE_API_URL ?? "http://localhost:3100").replace(/\/$/, "");
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
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
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(
    admin,
    anonKey,
    supabaseUrl,
    await pickAdminEmail(admin),
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const footer = page.locator(".sticky.bottom-0");
  const checkBtn = footer.getByRole("button", { name: "점검" });
  const listCollapsed =
    (await footer.getByText("필수", { exact: true }).count()) === 0 &&
    (await footer.getByText("권장", { exact: true }).count()) === 0;
  const barBefore = await footer.locator("div.flex.flex-wrap.items-center.justify-between").boundingBox();

  await checkBtn.click();
  await page.waitForTimeout(400);
  const listOpen =
    (await footer.getByText("필수", { exact: true }).count()) > 0 ||
    (await footer.getByText("권장", { exact: true }).count()) > 0;
  const checkEmpty = !listOpen;
  const foldVisible = checkEmpty
    ? true
    : await footer.getByRole("button", { name: "▾ 접기" }).isVisible();
  const barAfterOpen = await footer.locator("div.flex.flex-wrap.items-center.justify-between").boundingBox();
  const barStayed =
    checkEmpty ||
    (Boolean(barBefore && barAfterOpen) &&
      Math.abs((barAfterOpen?.y ?? 0) - (barBefore?.y ?? 0)) < 8);

  let folded = true;
  let toggleClosed = true;
  if (!checkEmpty) {
    await footer.getByRole("button", { name: "▾ 접기" }).click();
    await page.waitForTimeout(300);
    folded =
      (await footer.getByText("필수", { exact: true }).count()) === 0 &&
      (await footer.getByText("권장", { exact: true }).count()) === 0;

    await checkBtn.click();
    await page.waitForTimeout(300);
    await checkBtn.click();
    await page.waitForTimeout(300);
    toggleClosed =
      (await footer.getByText("필수", { exact: true }).count()) === 0 &&
      (await footer.getByText("권장", { exact: true }).count()) === 0;
  }

  await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=related`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.getByRole("heading", { name: "관련 콘텐츠" }).waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  const lunaIdle = await page.getByText("이 워크와 어울리는 콘텐츠를 루나가 골라 줄 수 있습니다.").count();
  const lunaLie = await page.getByText("어울리는 4개를 골라 넣어 뒀습니다").count();
  const topPickBtn = await page.locator(".rel-luna-row").getByRole("button", { name: "직접 고르기" }).count();
  const emptyPick = page.getByRole("button", { name: "직접 고르기" });
  if ((await emptyPick.count()) === 0) {
    await page.locator(".rel-acts button").filter({ hasText: "×" }).last().click();
    await page.waitForTimeout(200);
  }
  await emptyPick.first().click();
  await page.getByText("콘텐츠 고르기").waitFor({ state: "visible", timeout: 10_000 });
  const listRow = page.locator(".fixed button").filter({ has: page.locator("span.h-8") });
  await listRow.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => null);
  const pickerTitle = await page.getByText("콘텐츠 고르기").count();
  const pickerRows = await listRow.count();
  await page.getByRole("button", { name: "취소" }).click();
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "루나에게 추천받기" }).click();
  await page.getByRole("button", { name: "다시 골라줘" }).waitFor({
    state: "visible",
    timeout: 90_000,
  }).catch(() => null);
  const recommendOk = (await page.getByRole("button", { name: "다시 골라줘" }).count()) > 0;
  const lunaMarks = await page.locator(".rel-luna-mark").count();
  const lunaTitles = await page.locator(".rel-title").allTextContents();
  const lunaReason = await page.locator(".rel-luna-txt").innerText().catch(() => "");

  await page.getByRole("button", { name: "부분 저장" }).click();
  await page.getByText("저장되었습니다").waitFor({ state: "visible", timeout: 30_000 }).catch(() => null);

  const previewSecret = process.env.PREVIEW_SECRET?.trim() ?? "";
  const { data: workRow } = await admin
    .from("works")
    .select("slug")
    .eq("id", WORK_ID)
    .maybeSingle();
  const liveSlug = (workRow?.slug as string | undefined) ?? "";
  let publicInsight = false;
  let liveInsight = false;
  let publicSlug = liveSlug;
  if (previewSecret) {
    const previewUrl = `${SITE_URL}/preview/works/${WORK_ID}?token=${encodeURIComponent(previewSecret)}&locale=ko`;
    const previewPage = await context.newPage();
    await previewPage.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await previewPage.waitForTimeout(2500);
    const titles = await previewPage.locator(".related-articles__title").allTextContents();
    const hrefs = await previewPage.locator("a[href*='insight']").count();
    publicInsight = hrefs > 0 || titles.some((title) =>
      ["통로를 목적지로 바꾼 이야기", "미디어 아키텍처란 무엇인가", "고래가 헤엄치는 3분을 만들기까지"].includes(title.trim())
    );
    publicSlug = `preview titles=${titles.join(" | ")} hrefs=${hrefs}`;
    await previewPage.close();
  }
  if (liveSlug) {
    const live = await context.newPage();
    await live.goto(`${SITE_URL}/works/${liveSlug}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await live.waitForTimeout(2000);
    liveInsight = (await live.locator("a[href*='insight']").count()) > 0;
    await live.close();
  }

  const result = {
    checkEmpty,
    listCollapsed,
    listOpen,
    foldVisible,
    barStayed,
    folded,
    toggleClosed,
    lunaIdle: lunaIdle > 0,
    lunaLie: lunaLie === 0,
    topPickGone: topPickBtn === 0,
    pickerTitle: pickerTitle > 0,
    pickerRows,
    recommendOk,
    lunaMarks,
    lunaTitles,
    lunaReason,
    publicInsight,
    liveInsight,
    publicSlug,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    listCollapsed &&
    (checkEmpty || listOpen) &&
    foldVisible &&
    barStayed &&
    folded &&
    toggleClosed &&
    lunaIdle > 0 &&
    lunaLie === 0 &&
    topPickBtn === 0 &&
    pickerTitle > 0 &&
    pickerRows > 0 &&
    recommendOk &&
    lunaMarks === 4 &&
    consoleErrors.length === 0;

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
