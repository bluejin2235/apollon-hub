/**
 * 워크 기본 설명 — 공개(1920) vs 편집기 나란히 비교
 * npx tsx scripts/compare-work-lead-screens.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = "http://localhost:3100";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_SLUG = "star-avenue-renewal-lotte-duty-free";
const OUT = resolve(process.cwd(), "scripts/out-type-compare");

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

function measureP(el: Element) {
  const p = (el.querySelector("p") || el) as HTMLElement;
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || 30;
  return {
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    width: Math.round(r.width * 10) / 10,
    height: Math.round(r.height * 10) / 10,
    approxLines: Math.max(1, Math.round(r.height / lh)),
    text: p.innerText.slice(0, 120)
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? websiteEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    websiteEnv.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    websiteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("missing supabase env");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = await pickAdminEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(`${SITE_URL}/works/${WORK_SLUG}`, {
    waitUntil: "networkidle",
    timeout: 90_000
  });
  await page.waitForSelector(".content__body", { timeout: 30_000 });
  const pub = await page.locator(".content__body").first().evaluate(measureP);
  const pubShot = resolve(OUT, "compare-public-lead-1920.png");
  await page.locator(".content__heading").first().screenshot({ path: pubShot });

  await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForSelector(".lead-drop", { timeout: 60_000 });
  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead", { timeout: 15_000 });
  const ed = await page.locator(".rte-ed--work-lead").first().evaluate(measureP);
  const edShot = resolve(OUT, "compare-editor-lead-1920.png");
  await page.locator(".rte-ed--work-lead").first().screenshot({ path: edShot });

  const report = {
    viewport: "1920x1080",
    public: pub,
    editor: ed,
    lineMatch: pub.approxLines === ed.approxLines,
    fontMatch: pub.fontSize === ed.fontSize && pub.lineHeight === ed.lineHeight,
    widthDelta: Math.round((ed.width - pub.width) * 10) / 10,
    screenshots: { public: pubShot, editor: edShot }
  };
  writeFileSync(resolve(OUT, "compare-work-lead.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
