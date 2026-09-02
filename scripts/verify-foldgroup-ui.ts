/**
 * FoldGroup hydration · 접이식 · 하단 버튼 — Playwright 콘솔 확인
 * npx tsx scripts/verify-foldgroup-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_URL =
  `${HUB_URL}/website/works/3cdc1043-8d3b-4f60-9d67-3283508f7e1d?tab=basic`;

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
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  const hydrationErrors = consoleErrors.filter(
    (line) =>
      /hydration/i.test(line) ||
      /cannot be a descendant of/i.test(line) ||
      /<button> cannot/i.test(line),
  );

  const foldTitles = ["프로젝트 정보", "배경 영상", "태그", "내부 연결"];
  const fourFoldsVisible = (
    await Promise.all(
      foldTitles.map((title) =>
        page.locator(".wa.fold").filter({ hasText: title }).first().isVisible(),
      ),
    )
  ).every(Boolean);

  const autoSaveLabels = await page.getByText("자동 저장됨", { exact: true }).count();
  const headerExtras = await page.locator(".fh-extra").count();

  const fold = page.locator(".wa.fold").filter({ hasText: "프로젝트 정보" }).first();
  await fold.scrollIntoViewIfNeeded();
  const toggle = fold.locator("button.fh-toggle").first();

  const openBefore = await fold.evaluate((el) => el.classList.contains("on"));
  await toggle.click();
  await page.waitForTimeout(300);
  const openAfterToggle = await fold.evaluate((el) => el.classList.contains("on"));
  await toggle.click();
  await page.waitForTimeout(300);
  const openAfterSecond = await fold.evaluate((el) => el.classList.contains("on"));

  const foldToggles = openBefore !== openAfterToggle && openAfterToggle !== openAfterSecond;

  await toggle.click();
  await page.waitForTimeout(300);
  const openForPartial = await fold.evaluate((el) => el.classList.contains("on"));

  let partialSaveKeepsFold = true;
  const subtitleKo = fold.locator("input.i").first();
  if (await subtitleKo.isVisible().catch(() => false)) {
    const before = await subtitleKo.inputValue();
    await subtitleKo.fill(`${before}x`);
    const partialBtn = fold.locator(".fh-extra").getByRole("button", { name: /저장/ }).first();
    await partialBtn.click();
    await page.waitForTimeout(800);
    const openAfterPartial = await fold.evaluate((el) => el.classList.contains("on"));
    partialSaveKeepsFold = openAfterPartial === openForPartial;
    await subtitleKo.fill(before);
  }

  const bar = page.locator(".sticky.bottom-0").last();
  const btnWrap = bar.locator(".flex-nowrap").first();
  const wrapBox = await btnWrap.boundingBox();
  const hideBtn = bar.getByRole("button", { name: "감추기", exact: true });
  const hideVisible = await hideBtn.isVisible().catch(() => false);
  let bottomOneLine = true;
  if (hideVisible && wrapBox) {
    const hideBox = await hideBtn.boundingBox();
    if (hideBox) {
      bottomOneLine = Math.abs(hideBox.y - wrapBox.y) < 4;
    }
  }

  await browser.close();

  const report = {
    url: WORK_URL,
    consoleErrorCount: consoleErrors.length,
    hydrationErrorCount: hydrationErrors.length,
    consoleErrors: consoleErrors.slice(0, 10),
    fourFoldsVisible,
    autoSaveLabels,
    headerExtras,
    foldToggles,
    partialSaveKeepsFold,
    bottomButtonsOneLine: bottomOneLine,
  };

  console.log("\n=== foldgroup UI verify ===");
  console.log(JSON.stringify(report, null, 2));

  const failed =
    consoleErrors.length > 0 ||
    hydrationErrors.length > 0 ||
    !fourFoldsVisible ||
    autoSaveLabels !== 2 ||
    headerExtras !== 4 ||
    !foldToggles ||
    !partialSaveKeepsFold ||
    (hideVisible && !bottomOneLine);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
