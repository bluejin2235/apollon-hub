/**
 * Work lead editor ↔ public content__body measure + bold roundtrip.
 * npx tsx scripts/verify-work-lead-surface.ts
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
  mkdirSync(OUT, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("missing supabase env");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = await pickAdminEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);

  // draft lead from DB
  const { data: sections } = await admin
    .from("work_sections")
    .select("id, sort, headline, lead")
    .eq("work_id", WORK_ID)
    .order("sort", { ascending: true });
  const first = (sections ?? [])[0] as
    | { id: string; lead?: { ko?: string; en?: string } | null }
    | undefined;
  const draftLeadKo = first?.lead?.ko ?? "";

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForSelector(".lead-drop", { timeout: 60_000 });

  const preview = await page.locator(".lead-drop").first().evaluate((el) => {
    const htmlEl = el.querySelector(".lead-html");
    const target = (htmlEl || el) as HTMLElement;
    const cs = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      width: Math.round(rect.width * 10) / 10,
      html: target.innerHTML.slice(0, 400),
      text: target.innerText.slice(0, 200),
      lines: target.innerText.trim().split(/\n+/).filter(Boolean).length,
      pCount: target.querySelectorAll("p").length,
      brCount: (target.innerHTML.match(/<br\s*\/?>/gi) || []).length,
    };
  });

  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead", { timeout: 15_000 });

  const editor = await page.locator(".rte-ed--work-lead").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const paragraphs = [...el.querySelectorAll("p")].slice(0, 6).map((p) => {
      const c = getComputedStyle(p);
      const r = p.getBoundingClientRect();
      return {
        fontSize: c.fontSize,
        lineHeight: c.lineHeight,
        marginTop: c.marginTop,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        approxLines: Math.max(1, Math.round(r.height / (parseFloat(c.lineHeight) || 30))),
        text: p.innerText.slice(0, 80),
      };
    });
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      width: Math.round(rect.width * 10) / 10,
      className: el.className,
      html: el.innerHTML.slice(0, 500),
      text: el.innerText.slice(0, 250),
      lines: el.innerText.trim().split(/\n+/).filter(Boolean).length,
      pCount: el.querySelectorAll("p").length,
      paragraphs,
    };
  });

  await page.screenshot({ path: resolve(OUT, "work-lead-editor-after.png"), fullPage: false });

  // bold roundtrip in modal (confirm without section save if possible — click 확인 then check draft)
  const ed = page.locator(".rte-ed--work-lead").first();
  await ed.click();
  await page.keyboard.press("Control+A");
  await page.locator('.rte-tb button[title="굵게"]').click();
  const htmlWithBold = await ed.evaluate((el) => el.innerHTML);
  await page.locator(".lead-btns .btn.acc").click();
  await page.waitForTimeout(400);
  const previewAfterBold = await page.locator(".lead-drop .lead-html").first().evaluate((el) => ({
    html: el.innerHTML.slice(0, 400),
    hasB: /<b>|<strong>/i.test(el.innerHTML),
  }));

  // reopen and check bold still in editor draft state (not yet section-saved necessarily)
  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead", { timeout: 10_000 });
  const editorBold = await page.locator(".rte-ed--work-lead").first().evaluate((el) => ({
    html: el.innerHTML.slice(0, 400),
    hasB: /<b>|<strong>/i.test(el.innerHTML),
  }));
  // cancel to avoid leaving dirty if we want — actually leave and cancel
  await page.locator(".lead-mwh .xb").click();

  await page.goto(`${SITE_URL}/ko/works/${WORK_SLUG}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  const pub = await page.evaluate(() => {
    const body = document.querySelector(".content__body");
    if (!body) return { missing: true };
    const cs = getComputedStyle(body);
    const rect = body.getBoundingClientRect();
    const p = body.querySelector("p") || body;
    const pc = getComputedStyle(p);
    const pr = p.getBoundingClientRect();
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      width: Math.round(rect.width * 10) / 10,
      pFontSize: pc.fontSize,
      pLineHeight: pc.lineHeight,
      pMarginTop: pc.marginTop,
      pWidth: Math.round(pr.width * 10) / 10,
      pHeight: Math.round(pr.height * 10) / 10,
      approxLines: Math.max(1, Math.round(pr.height / (parseFloat(pc.lineHeight) || 30))),
      html: body.innerHTML.slice(0, 400),
      text: body.innerText.slice(0, 200),
      lines: body.innerText.trim().split(/\n+/).filter(Boolean).length,
      pCount: body.querySelectorAll("p").length,
    };
  });
  await page.screenshot({ path: resolve(OUT, "work-lead-public.png"), fullPage: false });

  const report = {
    draftLeadKoSample: draftLeadKo.slice(0, 200),
    draftHasBr: /<br/i.test(draftLeadKo),
    draftHasP: /<p/i.test(draftLeadKo),
    draftHasNewline: draftLeadKo.includes("\n"),
    draftLen: draftLeadKo.replace(/<[^>]+>/g, "").length,
    preview,
    editor,
    htmlWithBold: htmlWithBold.slice(0, 300),
    previewAfterBold,
    editorBold,
    pub,
  };
  writeFileSync(resolve(OUT, "work-lead-surface.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
