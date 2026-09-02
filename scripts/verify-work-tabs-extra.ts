/**
 * 워크 어드민 — 인터뷰 · 크레딧 · 이력 탭
 * npx tsx scripts/verify-work-tabs-extra.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const BASIC_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=basic`;

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
  const badResponses: string[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message.slice(0, 200)));
  page.on("response", async (res) => {
    if (res.status() >= 400) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 500);
      } catch {
        body = "";
      }
      badResponses.push(`${res.status()} ${res.request().method()} ${res.url()} ${body}`);
    }
  });

  try {
    await login(context, page, session, supabaseUrl);
    await page.goto(BASIC_URL, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.getByRole("button", { name: "전체 저장", exact: true }).waitFor({ timeout: 60_000 });

    const tabLabels = await page.evaluate(() => {
      const bar = document.querySelector(".mt-4.flex.gap-0\\.5") ?? document.querySelector(".border-b");
      const buttons = Array.from(document.querySelectorAll("button")).filter((btn) => {
        const t = (btn.textContent || "").replace(/\s+/g, "");
        return (
          t === "기본정보" ||
          t.includes("본문") && t.length < 8 ||
          t.includes("인터뷰") ||
          t.includes("크레딧") ||
          t === "FAQ" ||
          t.includes("연결") ||
          t.includes("이력")
        );
      });
      const wanted = ["기본정보", "본문", "인터뷰", "크레딧", "FAQ", "연결", "이력"];
      const found: string[] = [];
      for (const want of wanted) {
        const hit = buttons.find((btn) => (btn.textContent || "").replace(/\s+/g, "").includes(want));
        if (hit) found.push(want);
      }
      return { found, bar: bar ? true : false };
    });

    const tabsOk =
      tabLabels.found.join(",") === "기본정보,본문,인터뷰,크레딧,FAQ,연결,이력";

    await page.getByRole("button", { name: /인터뷰/ }).click();
    await page.getByRole("heading", { name: "인터뷰", exact: true }).waitFor({ timeout: 30_000 });

    const showBox = page.getByLabel("이 워크에 인터뷰 표시");
    await showBox.waitFor({ state: "visible", timeout: 10_000 });
    const wasOn = await showBox.isChecked();
    if (!wasOn) {
      await showBox.click();
      await page.waitForFunction(
        () => {
          const btn = Array.from(document.querySelectorAll("button")).find(
            (el) => (el.textContent || "").trim() === "바꾸기",
          ) as HTMLButtonElement | undefined;
          const input = document.querySelector(
            "label.sw input[type=checkbox]",
          ) as HTMLInputElement | null;
          return Boolean(input?.checked && btn && !btn.disabled);
        },
        null,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(800);
      if (!(await showBox.isChecked())) {
        throw new Error("interview switch did not stay on");
      }
    }

    await page.getByRole("button", { name: "바꾸기" }).click();
    await page.getByText("인사이트 고르기").waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll(".lrow").length > 0, null, {
      timeout: 20_000,
    });
    const pickCount = await page.locator(".lrow").count();
    await page.getByRole("button", { name: "취소" }).click();

    if (!wasOn) {
      await page.getByLabel("이 워크에 인터뷰 표시").click({ force: true });
      await page.waitForTimeout(2000);
    }

    await page.getByRole("button", { name: /크레딧/ }).click();
    await page.getByRole("heading", { name: "크레딧", exact: true }).waitFor({ timeout: 30_000 });
    const before = await page.locator(".cr").count();
    await page.getByRole("button", { name: "＋ 크레딧 추가" }).click();
    const afterAdd = await page.locator(".cr").count();
    await page.getByRole("button", { name: "＋ 크레딧 추가" }).click();
    const last = page.locator(".cr").last();
    await last.locator("input").first().fill("Lighting");
    const upEnabled = await last.locator("button", { hasText: "↑" }).isEnabled();
    await last.locator("button", { hasText: "↑" }).click();
    await page.locator(".cr").last().locator("button", { hasText: "×" }).click();
    await page.locator(".cr").last().locator("button", { hasText: "×" }).click();
    const afterDelete = await page.locator(".cr").count();

    await page.getByRole("button", { name: /이력/ }).click();
    await page.getByRole("heading", { name: "이력", exact: true }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const historyText = (await page.locator(".wa").innerText()).replace(/\s+/g, " ");
    const hasV1 = /v1/.test(historyText);

    const report = {
      tabs: tabLabels.found,
      tabsOk,
      interviewPickRows: pickCount,
      credits: { before, afterAdd, afterDelete, upEnabled },
      hasV1,
      consoleErrorCount: consoleErrors.length,
      consoleErrors: consoleErrors.slice(0, 8),
      badResponses: badResponses.slice(0, 12),
    };
    console.log("\n=== work tabs extra ===");
    console.log(JSON.stringify(report, null, 2));

    const creditsOk = afterAdd === before + 1 && afterDelete === before && upEnabled;
    if (
      !tabsOk ||
      pickCount < 1 ||
      !creditsOk ||
      !hasV1 ||
      consoleErrors.length > 0
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
