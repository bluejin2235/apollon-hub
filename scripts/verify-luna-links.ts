/**
 * 지식 › 2차 데이터 · 자습 › 2차 데이터 만들기 화면 확인
 * npx tsx scripts/verify-luna-links.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const OUT = resolve(process.cwd(), "tmp", "luna-links-verify");

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
  if (linkErr || !link?.properties?.hashed_token) {
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

function check(name: string, ok: boolean, failed: { n: number }) {
  console.log(ok ? `✓ ${name}` : `✗ ${name}`);
  if (!ok) failed.n += 1;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: profiles } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .not("email", "is", null)
    .limit(3);
  const email = profiles?.find((r) => typeof r.email === "string")?.email;
  if (!email) throw new Error("슈퍼관리자 없음");

  const session = await createSession(admin, anonKey, supabaseUrl, email as string);
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);
  const failed = { n: 0 };

  await page.goto(`${HUB_URL}/settings`, {
    waitUntil: "networkidle",
    timeout: 90_000
  });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "지식", exact: true }).click();
  await page.getByRole("button", { name: "2차 데이터", exact: true }).click();
  await page.getByRole("button", { name: /같은 것/ }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  const secondary = await page.locator("body").innerText();
  check("같은 것 칩에 건수", /같은 것\s*[1-9]/.test(secondary), failed);
  check("속한 것 칩에 건수", /속한 것\s*[1-9]/.test(secondary), failed);
  check("이어진 것 칩에 건수", /이어진 것\s*[1-9]/.test(secondary), failed);
  check("사람 확인 또는 자동 태그", /사람 확인|자동/.test(secondary), failed);
  await page.screenshot({ path: resolve(OUT, "01-secondary.png"), fullPage: true });

  await page.getByRole("button", { name: /속한 것/ }).click();
  await page.waitForTimeout(1200);
  const belongs = await page.locator("body").innerText();
  check("속한 것 트리", /Work 파일|이미지|노션|├/.test(belongs), failed);
  await page.screenshot({ path: resolve(OUT, "02-belongs.png"), fullPage: true });

  await page.getByRole("button", { name: /관점/ }).click();
  await page.waitForTimeout(1200);
  const persp = await page.locator("body").innerText();
  check("관점 표", persp.includes("구조") || persp.includes("연출") || persp.includes("붙은 건수"), failed);
  await page.screenshot({ path: resolve(OUT, "03-perspectives.png"), fullPage: true });

  await page.getByRole("button", { name: "자습", exact: true }).click();
  await page.getByRole("button", { name: "2차 데이터 만들기", exact: true }).click();
  await page.getByText("전체 진행률").waitFor({ timeout: 30_000 });
  const progress = await page.locator("body").innerText();
  check("연도 2026", progress.includes("2026"), failed);
  check("진행률 숫자", /[1-9]\d?\s*%|완료/.test(progress), failed);
  await page.screenshot({ path: resolve(OUT, "04-progress.png"), fullPage: true });

  await browser.close();
  if (failed.n > 0) {
    console.log(`FAILED ${failed.n}`);
    process.exit(1);
  }
  console.log("OK luna-links ui");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
