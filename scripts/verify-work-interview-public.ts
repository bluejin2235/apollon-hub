/**
 * 워크 인터뷰가 공개 상세 하단에 나오는지
 * npx tsx scripts/verify-work-interview-public.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = process.env.WEBSITE_API_URL ?? "http://localhost:3100";
const WORK_ID = "7ed48f01-4624-4bdf-a589-a79d907c67b7";
const ON_SLUG = "inspire-resort-media-show-under-the-blueland-2";
const OFF_SLUG = "inspire-resort-media-show-under-the-blueland";
const BASIC_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=interview`;

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

  const consoleErrors: string[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message.slice(0, 200)));

  try {
    await login(context, page, session, supabaseUrl);
    await page.goto(BASIC_URL, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.getByRole("heading", { name: "인터뷰", exact: true }).waitFor({ timeout: 60_000 });

    const showBox = page.getByLabel("이 워크에 인터뷰 표시");
    if (!(await showBox.isChecked())) {
      await showBox.click();
      await page.waitForFunction(
        () => {
          const btn = Array.from(document.querySelectorAll("button")).find(
            (el) => (el.textContent || "").trim() === "바꾸기",
          ) as HTMLButtonElement | undefined;
          return Boolean(btn && !btn.disabled);
        },
        null,
        { timeout: 20_000 },
      );
    }

    await page.getByRole("button", { name: "바꾸기" }).click();
    await page.getByText("인사이트 고르기").waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll(".lrow").length > 0, null, {
      timeout: 20_000,
    });
    await page.locator(".lrow").first().click();
    await page.waitForFunction(
      () => (document.querySelector(".pickd .t1")?.textContent || "").trim().length > 0,
      null,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(500);

    const quoteKo = page.locator(".two textarea").first();
    const quoteEn = page.locator(".two textarea").nth(1);
    const nameKo = page.locator(".two input[type=text]").first();
    const nameEn = page.locator(".two input[type=text]").nth(1);
    await quoteKo.fill("고래가 지나갈 때 사람들이 숨을 멈추는 순간이 있어요.");
    await quoteEn.fill("There's a moment when people hold their breath.");
    await nameKo.fill("김벼리 · 콘텐츠기획팀");
    await nameEn.fill("Kim Byeori · Content Planning");
    await page.waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll("button")).find(
          (el) => (el.textContent || "").trim() === "부분 저장",
        ) as HTMLButtonElement | undefined;
        return Boolean(btn && !btn.disabled);
      },
      null,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "부분 저장", exact: true }).click();
    const saved = await page.getByText("저장되었습니다").waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    if (!saved) {
      const body = (await page.locator(".wa").innerText()).replace(/\s+/g, " ").slice(0, 400);
      throw new Error(`interview partial save failed: ${body}`);
    }

    const bar = page.locator(".sticky.bottom-0").last();
    await bar.getByRole("button", { name: "전체 저장" }).waitFor({ timeout: 30_000 });
    const barText = (await bar.innerText()).replace(/\s+/g, " ");
    const publishBtn = bar.getByRole("button", { name: "공개", exact: true });
    if (!(await publishBtn.isVisible().catch(() => false))) {
      throw new Error(`publish button missing: ${barText.slice(0, 240)}`);
    }
    const publishEnabled = await publishBtn.isEnabled();
    if (!publishEnabled) {
      const reason = await page.locator(".sticky.bottom-0").innerText();
      throw new Error(`publish blocked: ${reason.replace(/\s+/g, " ").slice(0, 240)}`);
    }
    await publishBtn.click();
    await page.getByRole("dialog", { name: "공개하기" }).waitFor({ timeout: 20_000 });
    const note = page.locator("#publish-change-note");
    const noteVal = await note.inputValue();
    if (!noteVal.trim()) {
      await note.fill("인터뷰를 연결했습니다.");
    }
    await page.getByRole("button", { name: "공개 확인", exact: true }).click();
    const published = await page
      .getByText("공개되었습니다")
      .waitFor({ timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (!published) {
      const dump = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600);
      throw new Error(`publish did not finish: ${dump}`);
    }

    const site = await context.newPage();
    const siteErrors: string[] = [];
    site.on("console", (msg) => {
      if (msg.type() === "error") siteErrors.push(msg.text().slice(0, 200));
    });
    site.on("pageerror", (err) => siteErrors.push(err.message.slice(0, 200)));
    await site.goto(`${SITE_URL}/works/${ON_SLUG}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await site.locator(".work-interview").waitFor({ timeout: 30_000 });
    const interviewCount = await site.locator(".work-interview").count();
    const quoteText = interviewCount
      ? (await site.locator(".work-interview__quote").innerText()).trim()
      : "";
    const learnMore = site.locator(".work-interview__link");
    const learnMoreVisible = await learnMore.isVisible().catch(() => false);
    let learnMoreOpens = false;
    let afterClickUrl = "";
    if (learnMoreVisible) {
      await learnMore.click();
      const popup = await site
        .locator(".interview-popup")
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      afterClickUrl = site.url();
      learnMoreOpens = popup || /\/insight\//.test(afterClickUrl);
    }

    await site.goto(`${SITE_URL}/works/${OFF_SLUG}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await site.waitForTimeout(1000);
    const offCount = await site.locator(".work-interview").count();

    const report = {
      interviewCount,
      quoteText: quoteText.slice(0, 80),
      learnMoreVisible,
      learnMoreOpens,
      afterClickUrl,
      offCount,
      hubConsole: consoleErrors.length,
      siteConsole: siteErrors.length,
      siteErrors: siteErrors.slice(0, 6),
    };
    console.log("\n=== work interview public ===");
    console.log(JSON.stringify(report, null, 2));

    if (
      interviewCount !== 1 ||
      !quoteText ||
      !learnMoreVisible ||
      offCount !== 0 ||
      siteErrors.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
