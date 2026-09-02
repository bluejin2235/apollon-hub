/**
 * 통계 검색 화면 실측 — Playwright
 * npx tsx scripts/verify-stats-search-ui.ts
 *
 * 보는 것
 *  1 새/옛 사이트 구분이 사라졌는가
 *  2 1년을 고르면 추이가 그려지는가
 *  3 30일을 고르면 최근만 나오는가 (1년보다 점이 적다)
 *  4 기간을 바꾸면 다시 조회하는가
 */
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = resolve(process.cwd(), "tmp/stats-search-verify");

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
    .select("id, email, role")
    .eq("role", "슈퍼관리자")
    .limit(1);
  const email = (data ?? [])[0]?.email as string | undefined;
  if (!email) throw new Error("no super admin user");
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

/**
 * @supabase/ssr 은 세션을 base64- 를 앞에 붙인 쿠키에 담고, 길면 .0 .1 로 쪼갠다.
 * 브라우저 클라이언트가 읽는 곳이 쿠키이므로 localStorage 와 함께 넣는다.
 */
async function login(
  context: BrowserContext,
  page: Page,
  session: Session,
  supabaseUrl: string,
) {
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  // @supabase/ssr 0.12 는 base64url 로 담는다. 표준 base64 의 + / = 를 쓰면 못 읽는다
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

  console.log("cookie chunks written:", cookies.map((c) => c.name).join(", "));
}

/**
 * 화면에 실제로 그려진 것을 센다.
 * tsx(esbuild) 가 화살표 함수에 __name 을 끼워 넣어 브라우저에서 터진다.
 * 그래서 평가할 코드를 글자로 넘긴다.
 */
const READ_SCREEN = `(() => {
  var text = function (el) { return (el && el.textContent ? el.textContent : "").trim(); };
  var body = document.body.textContent || "";
  var kpis = Array.prototype.map.call(document.querySelectorAll(".ws-kpi"), function (kpi) {
    return {
      label: text(kpi.querySelector(".ws-lab-text")),
      value: text(kpi.querySelector(".ws-val"))
    };
  });
  var stamps = Array.prototype.map.call(document.querySelectorAll(".ws-stamp"), function (el) {
    return text(el);
  });

  return {
    heading: text(document.querySelector("h2.ws-pt")),
    mentionsLegacy: body.indexOf("옛 사이트") >= 0,
    mentionsNewSite: body.indexOf("새 사이트") >= 0 && body.indexOf("새 사이트 공개") < 0,
    sideLegacy: document.querySelectorAll(".ws-side-legacy, .ws-side-live").length,
    kpis: kpis,
    stamps: stamps.slice(0, 4),
    bars: document.querySelectorAll(".recharts-bar-rectangle").length,
    lines: document.querySelectorAll(".recharts-line-curve").length,
    dots: document.querySelectorAll(".recharts-symbols").length,
    sectors: document.querySelectorAll(".recharts-pie-sector").length,
    refLines: document.querySelectorAll(".recharts-reference-line").length,
    tableRows: document.querySelectorAll(".ws-table tbody tr").length,
    emptyCharts: Array.prototype.map
      .call(document.querySelectorAll(".ws-chart"), text)
      .filter(function (t) {
        return t.indexOf("데이터가 없습니다") >= 0;
      }).length
  };
})()`;

async function readScreen(page: Page) {
  return page.evaluate(READ_SCREEN);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });

  /** 기간을 바꾸면 다시 조회하는지 보려고 조회 요청을 모아 둔다 */
  const statsCalls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/website/stats")) statsCalls.push(url);
  });

  const report: Record<string, unknown> = {};

  try {
    await login(context, page, session, supabaseUrl);
    await page.goto(`${HUB_URL}/website/stats/search`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });

    report.url = page.url();
    await page.locator("h2.ws-pt").waitFor({ timeout: 60_000 }).catch(async () => {
      report.landedOn = page.url();
      report.bodyHead = (await page.locator("body").innerText()).slice(0, 400);
      throw new Error(`no ws-pt — landed on ${page.url()}`);
    });

    await page.locator(".ws-kpi .ws-val").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);

    report.default30d = await readScreen(page);
    report.callsAfterFirstLoad = statsCalls.length;
    report.firstCall = statsCalls[0] ?? null;
    await page.screenshot({
      path: resolve(OUT_DIR, "search-30d.png"),
      fullPage: true,
    });

    const before = statsCalls.length;
    await page.locator(".ws-seg button", { hasText: "1년" }).click();
    await page.waitForTimeout(4000);
    report.callsAfterPeriodChange = statsCalls.length;
    report.refetched = statsCalls.length > before;
    report.yearCall = statsCalls[statsCalls.length - 1] ?? null;
    report.year = await readScreen(page);
    await page.screenshot({
      path: resolve(OUT_DIR, "search-1y.png"),
      fullPage: true,
    });

    await page.locator(".ws-seg button", { hasText: "오늘" }).click();
    await page.waitForTimeout(4000);
    report.today = await readScreen(page);
    report.todayCall = statsCalls[statsCalls.length - 1] ?? null;

    report.consoleErrors = consoleErrors;
  } finally {
    await browser.close();
  }

  console.log("\n=== stats search UI verify ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
