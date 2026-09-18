/**
 * 1차 데이터 대시보드 화면 확인
 * npx tsx scripts/verify-primary-dashboard.ts
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
const OUT = resolve(process.cwd(), "tmp", "luna-primary-verify");

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

async function pickEmail(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .not("email", "is", null)
    .limit(5);
  const email = (data ?? []).find((r) => typeof r.email === "string")?.email;
  if (!email) throw new Error("슈퍼관리자 없음");
  return email as string;
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

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const email = await pickEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  let apiMs: number | null = null;
  let queryMs: number | null = null;
  page.on("response", (res) => {
    if (!res.url().includes("/api/luna-admin/primary")) return;
    const timing = res.request().timing();
    apiMs = timing.responseEnd;
    void res.json().then((json: { query_ms?: number }) => {
      if (typeof json.query_ms === "number") queryMs = json.query_ms;
    }).catch(() => undefined);
  });

  await page.goto(`${HUB_URL}/settings?menu=knowledge&sub=primary`, {
    waitUntil: "networkidle",
    timeout: 90_000
  });
  await page.getByText("문서가 검색에 닿는 과정").waitFor({ timeout: 30_000 });
  const text = await page.locator("body").innerText();
  const checks = [
    ["원천 카드 5", /Work서버/.test(text) && /노션/.test(text) && /이미지/.test(text) && /위키/.test(text) && /용어사전/.test(text)],
    ["흐름도", /읽을 수 있는 문서/.test(text) && /못 읽음/.test(text)],
    ["약속대로 도나", text.includes("약속대로 도나")],
    ["차지하는 용량", text.includes("차지하는 용량")],
    ["원천 표 없음", !text.includes("원천별 상세")]
  ] as const;
  for (const [name, ok] of checks) {
    console.log(ok ? `✓ ${name}` : `✗ ${name}`);
  }
  console.log(`api_ms=${apiMs ?? "?"} query_ms=${queryMs ?? "?"}`);
  await page.screenshot({ path: resolve(OUT, "01-primary-dashboard.png"), fullPage: true });

  await page.locator("button.src.work").click();
  await page.waitForURL(/source=workserver/, { timeout: 15_000 });
  await page.getByText("본문이 색인된 파일").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: resolve(OUT, "02-work-source.png"), fullPage: true });

  let listMs: number | null = null;
  let previewMs: number | null = null;
  page.on("response", (res) => {
    void res.json().then((json: { query_ms?: number }) => {
      if (typeof json.query_ms !== "number") return;
      if (res.url().includes("/primary/work/preview")) previewMs = json.query_ms;
      else if (res.url().includes("/primary/work")) listMs = json.query_ms;
    }).catch(() => undefined);
  });

  await page.locator("table tbody tr").first().click();
  await page.locator(".peek").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: resolve(OUT, "03-work-preview.png"), fullPage: true });
  console.log(`work_list_ms=${listMs ?? "?"} work_preview_ms=${previewMs ?? "?"}`);

  const workText = await page.locator("body").innerText();
  console.log(workText.includes("청크") && workText.includes("보는 중") ? "✓ 청크 미리보기" : "✗ 청크 미리보기");

  await context.close();
  await browser.close();
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
