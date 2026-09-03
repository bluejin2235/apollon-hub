/**
 * lead-ed ↔ 공개 .block-wysiwyg — 같은 문단·같은 폭 시각 비교
 * npx tsx scripts/verify-insight-lead-ed-visual.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL =
  process.env.SITE_URL ?? websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const COMPARE_WIDTH = 720;
const OUT = resolve(process.cwd(), "scripts/out-type-compare");
const SAMPLE_P =
  "<p>서울 광화문광장 일대가 미디어 아트 무대로 변신한다. 한강 주변의 노들섬·선유도공원·난지공원은 새로운 공공 미술 작품을 감상할 수 있는 명소로 조성된다.</p>";

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
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, url: HUB_URL, sameSite: "Lax" as const }))
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function measureFirstP(page: Page, rootSelector: string) {
  return page.locator(`${rootSelector} p`).first().evaluate((node, width) => {
    const el = node as HTMLElement;
    el.style.width = `${width}px`;
    el.style.maxWidth = `${width}px`;
    el.style.boxSizing = "border-box";
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
      fontFamily: cs.fontFamily,
      width: el.getBoundingClientRect().width,
      marginTop: cs.marginTop,
      lineCount: Math.max(tops.size, 1),
      text: (el.textContent ?? "").slice(0, 90),
    };
  }, COMPARE_WIDTH);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // 공개: 사이트 CSS가 로드된 페이지에 .block-wysiwyg 샘플 주입
  await page.goto(`${SITE_URL}/insight`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);
  await page.evaluate(
    ({ html, width }) => {
      document.getElementById("__type_compare_public__")?.remove();
      const host = document.createElement("div");
      host.id = "__type_compare_public__";
      host.setAttribute(
        "style",
        "position:fixed;left:16px;top:16px;z-index:99999;background:#fff;padding:12px;"
      );
      const box = document.createElement("div");
      box.className = "block-wysiwyg";
      box.style.width = `${width}px`;
      box.style.maxWidth = `${width}px`;
      box.innerHTML = html + html; // p + p 간격도 보이게
      host.appendChild(box);
      document.body.appendChild(host);
    },
    { html: SAMPLE_P, width: COMPARE_WIDTH }
  );
  await page.waitForTimeout(400);
  const publicP = await measureFirstP(page, "#__type_compare_public__ .block-wysiwyg");
  const publicP2margin = await page
    .locator("#__type_compare_public__ .block-wysiwyg p + p")
    .evaluate((el) => getComputedStyle(el).marginTop);
  await page.locator("#__type_compare_public__ .block-wysiwyg p").first().screenshot({
    path: resolve(OUT, "public-p1.png"),
  });

  await login(context, page, session, supabaseUrl);
  // work-admin.css 가 로드되는 본문 탭으로 이동
  await page.goto(
    `${HUB_URL}/website/insights/bbdfef0f-ea89-4785-ab9d-916065544b34?tab=content`,
    { waitUntil: "domcontentloaded", timeout: 120_000 }
  );
  await page.waitForTimeout(4000);
  await page.locator(".wa").first().waitFor({ timeout: 60_000 });

  const hasLeadEdRule = await page.evaluate(() => {
    return [...document.styleSheets].some((sheet) => {
      try {
        return [...(sheet.cssRules ?? [])].some((rule) =>
          String((rule as CSSStyleRule).selectorText ?? "").includes("lead-ed")
        );
      } catch {
        return false;
      }
    });
  });
  if (!hasLeadEdRule) {
    throw new Error("work-admin.css lead-ed rules not loaded on page");
  }

  await page.evaluate(
    ({ html, width }) => {
      document.getElementById("__type_compare_editor__")?.remove();
      const host = document.createElement("div");
      host.id = "__type_compare_editor__";
      host.className = "wa";
      host.setAttribute(
        "style",
        "position:fixed;left:16px;top:16px;z-index:99999;background:#fff;padding:12px;"
      );
      const ed = document.createElement("div");
      ed.className = "lead-ed";
      ed.style.width = `${width}px`;
      ed.style.maxWidth = `${width}px`;
      ed.style.minHeight = "0";
      ed.style.boxSizing = "border-box";
      ed.innerHTML = html + html;
      host.appendChild(ed);
      document.body.appendChild(host);
    },
    { html: SAMPLE_P, width: COMPARE_WIDTH }
  );
  await page.waitForTimeout(1000);

  const editorRoot = await page.locator("#__type_compare_editor__ .lead-ed").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
      fontFamily: cs.fontFamily,
      width: el.getBoundingClientRect().width,
      className: el.className,
    };
  });
  const editorP = await measureFirstP(page, "#__type_compare_editor__ .lead-ed");
  const editorP2margin = await page
    .locator("#__type_compare_editor__ .lead-ed p + p")
    .evaluate((el) => getComputedStyle(el).marginTop);
  await page.locator("#__type_compare_editor__ .lead-ed p").first().screenshot({
    path: resolve(OUT, "editor-p1.png"),
  });

  await browser.close();

  const report = {
    compareWidth: COMPARE_WIDTH,
    sharedClass: "lead-ed (+ lead-tb in InsightTextEditor)",
    public: { p: publicP, pPlusP_marginTop: publicP2margin },
    editor: { root: editorRoot, p: editorP, pPlusP_marginTop: editorP2margin },
    lineCountMatch: publicP.lineCount === editorP.lineCount,
    metricMatch:
      publicP.fontSize === editorP.fontSize &&
      publicP.lineHeight === editorP.lineHeight &&
      publicP2margin === editorP2margin &&
      Math.round(publicP.width) === Math.round(editorP.width),
    screenshots: {
      public: resolve(OUT, "public-p1.png"),
      editor: resolve(OUT, "editor-p1.png"),
    },
  };
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!report.lineCountMatch || !report.metricMatch) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
