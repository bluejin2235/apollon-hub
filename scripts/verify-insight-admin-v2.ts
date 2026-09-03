/**
 * 인사이트 어드민 v2 목업 — Playwright 확인
 * npx tsx scripts/verify-insight-admin-v2.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type ConsoleMessage, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";

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
  if (linkErr || !link.properties?.hashed_token) {
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = await pickAdminEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await login(context, page, session, supabaseUrl);

  const report: string[] = [];

  await page.goto(`${HUB_URL}/website/insights`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "인사이트" }).waitFor({ timeout: 60_000 });
  const listHasPublished = await page.getByRole("columnheader", { name: "공개일" }).isVisible();
  const listHasYear = await page.getByRole("columnheader", { name: "연도" }).isVisible().catch(() => false);
  const statusOptions = await page.getByLabel("상태").locator("option").allTextContents();
  const hasHiddenFilter = statusOptions.includes("감춤");
  await page.locator("table tbody tr").first().locator('button[aria-label="더 보기"]').click();
  const menuHasHide = await page.getByRole("menuitem", { name: "감추기" }).count();
  const menuHasDelete = await page.getByRole("menuitem", { name: "삭제" }).count();
  await page.keyboard.press("Escape");
  report.push(
    `list 공개일=${listHasPublished} 연도=${listHasYear} 감춤필터=${hasHiddenFilter} 메뉴감추기=${menuHasHide} 메뉴삭제=${menuHasDelete}`
  );

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 60_000 });
  await page.getByRole("heading", { name: "화면에 나오는 것" }).waitFor({ timeout: 30_000 });

  const tabs = ["기본정보", "본문", "연결", "이력"];
  const tabFound: string[] = [];
  for (const name of tabs) {
    if (await page.getByRole("button", { name, exact: true }).first().isVisible()) tabFound.push(name);
  }
  const extraFound: string[] = [];
  for (const name of ["인터뷰", "크레딧"]) {
    if (await page.getByRole("button", { name, exact: true }).first().isVisible().catch(() => false)) {
      extraFound.push(name);
    }
  }
  report.push(`tabs=${tabFound.join(",")} extra=${extraFound.join(",") || "없음"}`);

  for (const name of ["화면에 나오는 것", "대표 이미지", "검색과 AI 가 읽는 것"]) {
    report.push(`group ${name}=${await page.getByRole("heading", { name, exact: true }).isVisible()}`);
  }
  report.push(
    `그 밖의 것=${await page.getByRole("heading", { name: "그 밖의 것", exact: true }).isVisible().catch(() => false)}`
  );

  await page.getByRole("button", { name: "뉴스", exact: true }).click();
  await page.locator("[data-insight-news-fields]").waitFor({ timeout: 5_000 });
  const newsHints = await page.locator("[data-insight-news-fields] .hint-line").allTextContents();
  const newsOn = newsHints.some((t) => t.includes("매체 이름"));
  report.push(`news fields=${newsOn} hints=${JSON.stringify(newsHints)}`);

  const otherBtn = page.getByRole("button", { name: "랩", exact: true });
  if (await otherBtn.isVisible()) {
    await otherBtn.click();
  } else {
    await page.getByRole("button", { name: "컬처", exact: true }).click();
  }
  await page.waitForTimeout(300);
  const newsOff = (await page.locator("[data-insight-news-fields]").count()) > 0;
  report.push(`other category news fields=${newsOff}`);

  await page.getByRole("button", { name: "뉴스", exact: true }).click();
  const cropBtn = page.getByRole("button", { name: "비율·자르기" }).first();
  let ratiosOk = false;
  let thumbClass = "";
  if (await cropBtn.isVisible().catch(() => false)) {
    await cropBtn.click();
    await page.getByText("비율 고르고 자르기").waitFor({ timeout: 10_000 });
    const r1 = (await page.getByText("1 : 1 정사각").count()) > 0;
    const r2 = (await page.getByText("3 : 4 세로").count()) > 0;
    const r3 = (await page.getByText("16 : 9 가로").count()) > 0;
    ratiosOk = r1 && r2 && r3;
    report.push(`crop ratios 1:1=${r1} 3:4=${r2} 16:9=${r3}`);
    await page.getByRole("button", { name: "1 : 1 정사각" }).click();
    const save = page.getByRole("dialog").getByRole("button", { name: "저장", exact: true });
    const enabled = await save.isEnabled({ timeout: 20_000 }).catch(() => false);
    report.push(`crop save enabled=${enabled}`);
    if (enabled) {
      await save.click();
      await page.getByText("비율 고르고 자르기").waitFor({ state: "hidden", timeout: 60_000 }).catch(() => null);
      const partials = page.getByRole("button", { name: "부분 저장" });
      if ((await partials.count()) > 1) await partials.nth(1).click();
      await page.waitForTimeout(1200);
    } else {
      await page.getByRole("button", { name: "취소" }).click();
    }
  } else {
    report.push("crop button=false");
  }

  await page.goto(`${HUB_URL}/website/insights`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "인사이트" }).waitFor({ timeout: 60_000 });
  thumbClass =
    (await page.locator("table tbody tr").first().locator("img.ins-thumb, span.ins-thumb").getAttribute("class")) ??
    "";
  report.push(`list thumb class=${thumbClass}`);

  const filtered = errors.filter((line) => !/favicon|Download the React DevTools/i.test(line));
  report.push(`console errors=${filtered.length}${filtered.length ? ` ${filtered.join(" | ")}` : ""}`);
  console.log(report.join("\n"));

  if (
    !listHasPublished ||
    listHasYear ||
    !hasHiddenFilter ||
    menuHasDelete > 0 ||
    tabFound.length !== 4 ||
    extraFound.length > 0 ||
    !newsOn ||
    newsOff ||
    !ratiosOk ||
    filtered.length > 0
  ) {
    throw new Error("VERIFY_FAIL\n" + report.join("\n"));
  }
  console.log("VERIFY_OK");
  await browser.close();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
