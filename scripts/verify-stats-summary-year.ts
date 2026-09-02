/**
 * 요약 1년 — 루나 총평 단위(이탈률 %) · 캐시 무효화 확인
 * npx tsx scripts/verify-stats-summary-year.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";

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

const READ = `(() => {
  var text = function (el) { return (el && el.textContent ? el.textContent : "").trim(); };
  var luna = document.querySelector(".ws-luna");
  var lunaText = luna ? text(luna.querySelector("p")) : null;
  return {
    lunaText: lunaText,
    hasDecimalBounce: lunaText ? /이탈률[^。\\n]*0\\.\\d+/.test(lunaText) : false,
    hasPctBounce: lunaText ? /이탈률[^。\\n]*\\d+(\\.\\d+)?\\s*%/.test(lunaText) : false,
    hasBare056: lunaText ? /\\b0\\.5\\d\\b/.test(lunaText) : false
  };
})()`;

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
  const session = await createSession(admin, anonKey, supabaseUrl);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
  });

  try {
    await login(context, page, session, supabaseUrl);

    // 옛 루나 문장 캐시 삭제
    await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf("ws-stats-brief:") === 0) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    });

    await page.goto(`${HUB_URL}/website/stats/summary`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    await page.locator("h2.ws-pt").waitFor({ timeout: 60_000 });
    await page.locator(".ws-seg button", { hasText: "1년" }).click();

    await page.waitForFunction(
      () => {
        const val = document.querySelector(".ws-kpi .ws-val");
        return val && (val.textContent || "").trim() !== "—" && (val.textContent || "").trim() !== "";
      },
      { timeout: 90_000 },
    );

    await page.waitForFunction(
      () => {
        const luna = document.querySelector(".ws-luna");
        if (!luna) return false;
        const t = (luna.textContent || "").trim();
        return (
          t.indexOf("요약을 만드는 중") < 0 &&
          (t.indexOf("요약을 만들지 못했습니다") >= 0 ||
            (luna.querySelector("p") && (luna.querySelector("p")!.textContent || "").length > 20))
        );
      },
      { timeout: 120_000 },
    );

    const screen = await page.evaluate(READ);
    const ok =
      typeof screen.lunaText === "string" &&
      screen.lunaText.length > 0 &&
      !screen.hasDecimalBounce &&
      !screen.hasBare056 &&
      screen.hasPctBounce;

    console.log("\n=== summary 1y units ===");
    console.log(
      JSON.stringify(
        {
          ok,
          lunaText: screen.lunaText,
          checks: {
            hasDecimalBounce: screen.hasDecimalBounce,
            hasBare056: screen.hasBare056,
            hasPctBounce: screen.hasPctBounce,
          },
          consoleErrors,
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
