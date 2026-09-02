/**
 * 공개하기 막힘 이유 표시 · 점검 통과 시 팝업
 * npx tsx scripts/verify-publish-button-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const BLOCKED_URL =
  `${HUB_URL}/website/works/3cdc1043-8d3b-4f60-9d67-3283508f7e1d?tab=basic`;
const PASS_URL =
  `${HUB_URL}/website/works/7ed48f01-4624-4bdf-a589-a79d907c67b7?tab=basic`;

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

  // 1) blocked work — reason visible, publish disabled
  await page.goto(BLOCKED_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=공개하기", { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const reasonVisible =
    (await page.getByText(/공개하려면 \d+가지가 더 필요합니다/).count()) > 0;
  const publishBtn = page.getByRole("button", { name: "공개하기" });
  const publishDisabled = await publishBtn.isDisabled();
  const statusText = await page.locator(".sticky.bottom-0 p").first().innerText();

  // 2) pass-ready work — publish enabled, modal + luna note
  await page.goto(PASS_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=공개하기", { timeout: 60_000 });
  await page.waitForTimeout(2500);

  const passPublish = page.getByRole("button", { name: "공개하기" });
  const passEnabled = await passPublish.isEnabled();
  let modalOpen = false;
  let lunaNote = "";
  if (passEnabled) {
    await passPublish.click();
    const dialog = page.getByRole("dialog", { name: "공개하기" });
    await dialog.waitFor({ state: "visible", timeout: 60_000 });
    modalOpen = true;
    const noteBox = dialog.locator("textarea");
    for (let i = 0; i < 40; i++) {
      lunaNote = (await noteBox.inputValue()).trim();
      if (lunaNote.length > 0) break;
      await page.waitForTimeout(500);
    }
    await dialog.getByRole("button", { name: "취소" }).click();
  }

  const result = {
    statusText,
    reasonVisible,
    publishDisabled,
    passEnabled,
    modalOpen,
    lunaNote,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    reasonVisible && publishDisabled && passEnabled && modalOpen && lunaNote.length > 0;
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
