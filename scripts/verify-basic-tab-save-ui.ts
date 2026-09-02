/**
 * 기본정보 탭 — 썸네일 후보 셋 · 부분 저장 문구
 * npx tsx scripts/verify-basic-tab-save-ui.ts
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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await login(context, page, session, supabaseUrl);
  await page.goto(`${HUB_URL}/website/works`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector(".nm:text('썸네일에 쓸 이미지')", { timeout: 60_000 });
  await page.waitForTimeout(1000);

  const pickCount = await page.locator(".pick > button.pk").count();
  const caps = await page.locator(".pick .cap, .pick.pk.add, .pick > .pk.add").allTextContents();
  const pickTexts = await page.locator(".pick").first().innerText();
  const hasSaveAnHam = (await page.getByText("저장 안 함").count()) > 0;
  const partialLabels = await page.getByRole("button", { name: "부분 저장" }).allTextContents();
  const hasTlNumbered = /T-L\s*·\s*\d/.test(pickTexts);
  const hasTsCandidate = /T-S/.test(pickTexts);
  const hasDirect = pickTexts.includes("직접 올리기");

  const yearInput = page
    .locator("section.grp")
    .first()
    .locator(".row-cy input.i")
    .first();
  const before = await yearInput.inputValue();
  await yearInput.fill(before === "2026" ? "2025" : "2026");
  await page.waitForTimeout(300);
  const dirtyVisible =
    (await page.getByText("저장할 것이 있습니다").count()) > 0;

  const partialBtn = page.getByRole("button", { name: "부분 저장" }).first();
  await partialBtn.click();
  await page.waitForTimeout(2000);
  const savedVisible =
    (await page.getByText("저장되었습니다").count()) > 0;

  await yearInput.fill(before);
  const restoreBtn = page.getByRole("button", { name: "부분 저장" }).first();
  if (await restoreBtn.isEnabled()) {
    await restoreBtn.click();
    await page.waitForTimeout(800);
  }

  const result = {
    pickCount,
    caps,
    hasSaveAnHam,
    partialButtonTexts: partialLabels,
    dirtyVisible,
    savedVisible,
    hasTlNumbered,
    hasTsCandidate,
    hasDirect,
    hasThumbLabel: (await page.getByText("썸네일에 쓸 이미지").count()) > 0,
    hasOldCardLabel: (await page.getByText("카드에 쓸 이미지", { exact: true }).count()) > 0,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    pickCount >= 1 &&
    pickCount <= 3 &&
    hasDirect &&
    !hasTlNumbered &&
    !hasTsCandidate &&
    !hasSaveAnHam &&
    partialLabels.every((t) => t.trim() === "부분 저장") &&
    dirtyVisible &&
    savedVisible &&
    result.hasThumbLabel &&
    !result.hasOldCardLabel;

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
