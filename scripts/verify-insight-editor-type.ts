/**
 * 인사이트 편집기 ↔ 공개 본문 타이포 비교
 * npx tsx scripts/verify-insight-editor-type.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL =
  process.env.SITE_URL ?? websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const INSIGHT_SLUG = "insight-1788401143052";
const INSIGHT_ID = "bbdfef0f-ea89-4785-ab9d-916065544b34";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  token_type: string;
  user: unknown;
};

type Metrics = {
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  marginTop: string;
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

async function metrics(page: Page, selector: string): Promise<Metrics | null> {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  return el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
      marginTop: cs.marginTop,
    };
  });
}

async function main() {
  const beforeEditor = {
    fontSize: "12.5px",
    lineHeight: "leading-relaxed ≈ 20.3px (1.625×12.5)",
    letterSpacing: "(inherit)",
    pMargin: "my-1 = 4px",
  };

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

  await page.goto(`${SITE_URL}/insight/${INSIGHT_SLUG}`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForTimeout(800);
  const publicP = await metrics(page, ".block-wysiwyg p");
  const publicP2 = await metrics(page, ".block-wysiwyg p + p");

  await login(context, page, session, supabaseUrl);
  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForTimeout(2500);

  const editorRoot = page.locator(".insight-ed").first();
  const editorVisible = await editorRoot.isVisible().catch(() => false);
  let editorP: Metrics | null = null;
  let editorP2: Metrics | null = null;
  let editorRootMetrics: Metrics | null = null;

  if (editorVisible) {
    editorRootMetrics = await metrics(page, ".insight-ed");
    const pCount = await editorRoot.locator("p").count();
    if (pCount === 0) {
      await editorRoot.evaluate((el) => {
        el.innerHTML = "<p>한 문단</p><p>두 문단</p>";
      });
      await page.waitForTimeout(200);
    }
    editorP = await metrics(page, ".insight-ed p");
    editorP2 = await metrics(page, ".insight-ed p + p");
  }

  await browser.close();

  const match =
    publicP &&
    editorP &&
    publicP.fontSize === editorP.fontSize &&
    publicP.lineHeight === editorP.lineHeight &&
    publicP2?.marginTop === editorP2?.marginTop;

  const report = {
    beforeEditor,
    public: { p: publicP, pPlusP_marginTop: publicP2?.marginTop },
    editor: {
      visible: editorVisible,
      root: editorRootMetrics,
      p: editorP,
      pPlusP_marginTop: editorP2?.marginTop,
    },
    match,
  };
  console.log("\n=== insight editor type verify ===");
  console.log(JSON.stringify(report, null, 2));

  if (!match) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
