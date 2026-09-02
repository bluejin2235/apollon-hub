/**
 * 워크 기본정보 탭 v2 목업 — Playwright 확인
 * npx tsx scripts/verify-basic-tab-v2-ui.ts
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
  await page.goto(`${HUB_URL}/website/works`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("h3", { timeout: 60_000 });
  await page.waitForTimeout(1500);

  const headings = await page.locator("section.grp h3").allTextContents();
  const titleInputs = await page.locator("section.grp").first().locator("input.i").count();
  const hasSubtitle = (await page.getByText("부제", { exact: true }).count()) > 0;
  const qBtn = page.locator("button.q").first();
  await qBtn.click();
  const helpOpen = await page.locator(".qp.on").count();
  const helpRows = await page.locator(".qp.on dt").allTextContents();
  await page.locator(".qp.on .xb").click();

  const addFolder = page.getByRole("button", { name: "＋ 폴더 추가" });
  await addFolder.scrollIntoViewIfNeeded();
  const beforeExtras = await page.locator(".fld-path").count();
  await addFolder.click();
  const afterExtras = await page.locator(".fld-path").count();
  const pendingDelete = page.locator(".fld-path .xb-row").last();
  if ((await pendingDelete.count()) > 0) {
    await pendingDelete.click();
  }
  const afterDelete = await page.locator(".fld-path").count();

  const result = {
    headings,
    titleInputCountInFirstGroupApprox: titleInputs,
    hasSubtitleLabel: hasSubtitle,
    helpOpen,
    helpRows,
    folderAdd: { beforeExtras, afterExtras, afterDelete },
    consoleErrors,
    url: page.url(),
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    headings[0] === "화면에 나오는 것" &&
    headings[1] === "이미지와 영상" &&
    headings[2] === "검색과 AI 가 읽는 것" &&
    headings[3] === "그 밖의 것" &&
    !hasSubtitle &&
    helpOpen === 1 &&
    helpRows.join(",") === "쓰임,기준,주의,비면" &&
    afterExtras === beforeExtras + 1 &&
    afterDelete === beforeExtras &&
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
