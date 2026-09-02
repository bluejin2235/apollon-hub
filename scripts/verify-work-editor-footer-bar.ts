/**
 * 워크 편집 상·하단 버튼 바 목업 확인
 * npx tsx scripts/verify-work-editor-footer-bar.ts
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
  await page.waitForTimeout(2000);

  const header = page.locator("h1").locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  const headerPreview = (await header.getByRole("button", { name: "미리보기 ↗" }).count()) > 0;
  const headerSave = (await header.getByRole("button", { name: "전체 저장" }).count()) > 0;
  const savedLine = await page.getByText(/마지막 저장/).first().isVisible();

  const footer = page.locator(".sticky.bottom-0");
  const footerPreview = (await footer.getByRole("button", { name: "미리보기 ↗" }).count()) > 0;
  const footerSave = (await footer.getByRole("button", { name: "전체 저장" }).count()) > 0;
  const checkBtn = footer.getByRole("button", { name: "점검" });
  const checkVisible = await checkBtn.isVisible();
  const checkClass = (await checkBtn.getAttribute("class")) ?? "";
  const checkRed = checkClass.includes("border-red") || checkClass.includes("text-red");
  const publishBtn = footer.getByRole("button", { name: "공개", exact: true });
  const publishDisabled = await publishBtn.isDisabled();
  const hideGone = (await footer.getByRole("button", { name: "감추기" }).count()) === 0;
  const oldPanelGone = (await page.getByRole("button", { name: "공개 전 점검" }).count()) === 0;

  const mustPill = (await footer.getByText("필수", { exact: true }).count()) > 0;
  const listOpen = mustPill || (await footer.getByText("권장", { exact: true }).count()) > 0;

  const goBtn = footer.getByRole("button", { name: "가기" }).first();
  let goTabOk = false;
  if (await goBtn.count()) {
    const before = page.url();
    await goBtn.click();
    await page.waitForTimeout(800);
    const after = page.url();
    goTabOk = after !== before || after.includes("tab=");
  }

  const result = {
    headerPreview,
    headerSave,
    savedLine,
    footerPreview,
    footerSave,
    checkVisible,
    checkRed,
    publishDisabled,
    hideGone,
    oldPanelGone,
    listOpen,
    goTabOk,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    headerPreview &&
    headerSave &&
    savedLine &&
    footerPreview &&
    footerSave &&
    checkVisible &&
    checkRed &&
    publishDisabled &&
    hideGone &&
    oldPanelGone &&
    listOpen &&
    goTabOk &&
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
