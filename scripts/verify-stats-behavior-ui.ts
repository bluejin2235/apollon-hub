/**
 * 통계 행동 화면 실측 — Playwright
 * npx tsx scripts/verify-stats-behavior-ui.ts
 *
 * 보는 것
 *  1 오류 없이 열리는가
 *  2 빈 상태가 제대로 나오는가 (0 을 그리지 않는가)
 *  3 못 만든 자리에 이유가 적혀 있는가
 *  4 기간을 바꾸면 다시 조회하는가
 */
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = resolve(process.cwd(), "tmp/stats-behavior-verify");

function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

async function pickAdminEmail(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("email, role")
    .eq("role", "슈퍼관리자")
    .limit(1);
  const email = (data ?? [])[0]?.email as string | undefined;
  if (!email) throw new Error("no super admin user");
  return email;
}

async function createSession(admin: SupabaseClient, anonKey: string, supabaseUrl: string) {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: await pickAdminEmail(admin),
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
  return data.session;
}

/** @supabase/ssr 0.12 는 base64url 쿠키로 담는다 */
async function login(
  context: BrowserContext,
  page: Page,
  session: unknown,
  supabaseUrl: string,
) {
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const packed = `base64-${Buffer.from(JSON.stringify(session))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
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
}

/**
 * tsx(esbuild) 가 화살표 함수에 __name 을 끼워 넣어 브라우저에서 터진다.
 * 그래서 평가할 코드를 글자로 넘긴다.
 */
const READ_SCREEN = `(() => {
  var text = function (el) { return (el && el.textContent ? el.textContent : "").trim(); };
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  return {
    heading: text(document.querySelector("h2.ws-pt")),
    sections: all(".ws-sec").map(function (sec) {
      return {
        title: text(sec.querySelector(".ws-sech h3")) || text(sec.querySelector(".ws-ct")),
        charts: sec.querySelectorAll(".ws-chart").length,
        bars: sec.querySelectorAll(".recharts-bar-rectangle").length,
        lines: sec.querySelectorAll(".recharts-line-curve").length,
        empties: Array.prototype.map
          .call(sec.querySelectorAll(".ws-chart"), text)
          .filter(function (t) {
            return t.indexOf("데이터가 없습니다") >= 0 || t.indexOf("불러오는 중") >= 0;
          }).length,
        blocked: Array.prototype.map.call(sec.querySelectorAll(".ws-blocked"), function (el) {
          return text(el).slice(0, 46);
        }),
        kpis: Array.prototype.map.call(sec.querySelectorAll(".ws-kpi"), function (k) {
          return text(k.querySelector(".ws-lab-text")) + "=" + text(k.querySelector(".ws-val"));
        })
      };
    }),
    funnel: all(".ws-fn-col").map(function (col) {
      return {
        label: text(col.querySelector("em")),
        value: text(col.querySelector("b")),
        share: text(col.querySelector("u")),
        drawable: !col.classList.contains("ws-fn-col-none")
      };
    }),
    heatCells: document.querySelectorAll(".ws-hm i").length,
    zeroBars: all(".recharts-bar-rectangle").length
  };
})()`;

/**
 * 깔때기와 히트맵은 값이 있어야 그려진다. 지금 DB 는 0행이라 빈 상태만 보이고
 * 그리는 코드가 한 번도 안 돌아 본다. 그래서 이 스크립트 안에서만 가짜 응답을
 * 끼워 「값이 들어오면 제대로 그려지는가」를 확인한다.
 * ★ 이 값은 테스트 안에만 있다. 제품과 DB 에는 들어가지 않는다.
 */
function fakePoint(kind: string, date: string, extra: Record<string, unknown>) {
  return {
    source: "ga4",
    kind,
    date,
    key: null,
    key2: null,
    clicks: null,
    impressions: null,
    ctr: null,
    position: null,
    users: null,
    new_users: null,
    sessions: null,
    engaged_sessions: null,
    engagement_rate: null,
    avg_seconds: null,
    views: null,
    events: null,
    ...extra,
  };
}

function fakeResult(kind: string, current: unknown[], previous: unknown[] = []) {
  return {
    from: "2026-08-04",
    to: "2026-09-02",
    prev_from: "2026-07-05",
    prev_to: "2026-08-03",
    kind,
    current,
    previous,
    baseline: [],
    baseline_overall: [],
    totals: {},
    by_key: [],
  };
}

function fakeBundle() {
  const days = ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

  return {
    daily: fakeResult(
      "daily",
      days.map((date, i) =>
        fakePoint("daily", date, {
          users: 240 + i * 4,
          new_users: 200 + i * 3,
          sessions: 300 + i * 5,
          views: 780 + i * 12,
          avg_seconds: 62 + i * 4,
        }),
      ),
    ),
    page: fakeResult("page", [
      fakePoint("page", days[0], { key: "/contact", users: 14, views: 20 }),
      fakePoint("page", days[1], { key: "/en/contact", users: 3, views: 4 }),
      fakePoint("page", days[1], { key: "/works/star-avenue", users: 90, views: 140 }),
    ]),
    landing: fakeResult("landing", [
      fakePoint("landing", days[0], {
        key: "/works/star-avenue",
        sessions: 120,
        engagement_rate: 0.35,
      }),
      fakePoint("landing", days[0], { key: "/", sessions: 90, engagement_rate: 0.6 }),
      fakePoint("landing", days[1], { key: "/career", sessions: 40, engagement_rate: 0.5 }),
    ]),
    event: fakeResult(
      "event",
      [
        fakePoint("event", days[0], { key: "generate_lead", events: 2, users: 2 }),
        fakePoint("event", days[1], { key: "newsletter_signup", events: 3, users: 3 }),
        fakePoint("event", days[2], { key: "talent_signup", events: 1, users: 1 }),
      ],
      [fakePoint("event", "2026-07-20", { key: "newsletter_signup", events: 1, users: 1 })],
    ),
    hourly: fakeResult(
      "hourly",
      days.flatMap((date) =>
        [9, 11, 14, 15, 20].map((hour) =>
          fakePoint("hourly", date, { key: String(hour).padStart(2, "0"), users: hour }),
        ),
      ),
    ),
  };
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
  const session = await createSession(admin, anonKey, supabaseUrl);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message.slice(0, 200)}`));

  const statsCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/website/stats")) statsCalls.push(req.url());
  });

  const report: Record<string, unknown> = {};

  try {
    await login(context, page, session, supabaseUrl);
    await page.goto(`${HUB_URL}/website/stats/behavior`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });

    report.url = page.url();
    await page.locator("h2.ws-pt").waitFor({ timeout: 60_000 }).catch(async () => {
      report.landedOn = page.url();
      throw new Error(`no ws-pt — landed on ${page.url()}`);
    });
    await page.waitForTimeout(3500);

    report.default30d = await page.evaluate(READ_SCREEN);
    report.callsAfterFirstLoad = statsCalls.length;
    report.firstCall = statsCalls[0] ?? null;
    await page.screenshot({ path: resolve(OUT_DIR, "behavior-30d.png"), fullPage: true });

    const blocks = page.locator(".ws-sec");
    for (let i = 0; i < (await blocks.count()); i += 1) {
      await blocks.nth(i).screenshot({ path: resolve(OUT_DIR, `block-${i}.png`) });
    }

    // 기간 바꾸기 — 1년으로
    const before = statsCalls.length;
    await page.locator(".ws-seg button", { hasText: "1년" }).click();
    await page.waitForTimeout(4000);
    report.callsAfterPeriodChange = statsCalls.length;
    report.refetched = statsCalls.length > before;
    report.lastCall = statsCalls[statsCalls.length - 1] ?? null;

    // 값이 들어오면 깔때기·히트맵이 실제로 그려지는지
    await page.route("**/api/website/stats**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: fakeBundle() }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("h2.ws-pt").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3500);

    report.withFakeRows = await page.evaluate(READ_SCREEN);
    await page.screenshot({ path: resolve(OUT_DIR, "behavior-drawn.png"), fullPage: true });
    await page
      .locator(".ws-sec")
      .nth(0)
      .screenshot({ path: resolve(OUT_DIR, "drawn-funnel.png") });
    await page
      .locator(".ws-sec")
      .nth(2)
      .screenshot({ path: resolve(OUT_DIR, "drawn-heatmap.png") });

    report.consoleErrors = consoleErrors;
  } finally {
    await browser.close();
  }

  console.log("\n=== stats behavior UI verify ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
