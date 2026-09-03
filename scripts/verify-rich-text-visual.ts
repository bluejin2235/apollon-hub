/**
 * 실제 어드민 편집기 ↔ 실제 공개 본문. 줄 수·끊기는 글자를 본다.
 * npx tsx scripts/verify-rich-text-visual.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local"), "utf8"));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = (
  process.env.SITE_URL ??
  websiteEnv.NEXT_PUBLIC_SITE_URL ??
  "http://localhost:3100"
).replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";
const OUT = resolve(process.cwd(), "tmp/rich-text-visual");

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

type LineBreak = { line: number; start: string; end: string; text: string };

async function readParagraph(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((node) => {
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    const text = el.textContent ?? "";
    const lines: LineBreak[] = [];
    if (text.length === 0) {
      return {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
        fontFamily: cs.fontFamily,
        width: el.getBoundingClientRect().width,
        marginTop: cs.marginTop,
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        lines: [],
        lineCount: 0,
        text
      };
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let walk = walker.nextNode();
    while (walk) {
      nodes.push(walk as Text);
      walk = walker.nextNode();
    }
    const range = document.createRange();
    let currentTop: number | null = null;
    let lineStart = 0;
    let index = 0;
    for (const textNode of nodes) {
      const value = textNode.data;
      for (let i = 0; i < value.length; i += 1) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) {
          index += 1;
          continue;
        }
        const top = Math.round(rect.top);
        if (currentTop === null) currentTop = top;
        if (top > currentTop + 2) {
          const chunk = text.slice(lineStart, index);
          lines.push({
            line: lines.length + 1,
            start: chunk.slice(0, 8),
            end: chunk.slice(-8),
            text: chunk
          });
          lineStart = index;
          currentTop = top;
        }
        index += 1;
      }
    }
    const last = text.slice(lineStart);
    if (last) {
      lines.push({
        line: lines.length + 1,
        start: last.slice(0, 8),
        end: last.slice(-8),
        text: last
      });
    }
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
      fontFamily: cs.fontFamily,
      width: Math.round(el.getBoundingClientRect().width * 10) / 10,
      marginTop: cs.marginTop,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      lines,
      lineCount: lines.length,
      text
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  try {
    await page.locator(".rte-ed").first().waitFor({ timeout: 60_000 });
  } catch (err) {
    await page.screenshot({ path: resolve(OUT, "editor-fail.png"), fullPage: true });
    throw err;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  const longestEditor = page.locator(".rte-ed p").evaluateAll((nodes) => {
    let best = 0;
    let bestLen = -1;
    nodes.forEach((node, index) => {
      const len = (node.textContent ?? "").length;
      if (len > bestLen) {
        best = index;
        bestLen = len;
      }
    });
    return best;
  });
  const editorIndex = await longestEditor;
  const editorP = page.locator(".rte-ed p").nth(editorIndex);
  await editorP.scrollIntoViewIfNeeded();
  const editorShot = resolve(OUT, "editor.png");
  await editorP.screenshot({ path: editorShot });
  const editor = await readParagraph(page, `.rte-ed p >> nth=${editorIndex}`);
  const editorRoot = await page.locator(".rte-ed").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      width: Math.round(el.getBoundingClientRect().width * 10) / 10,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`
    };
  });

  const detail = await fetch(`${SITE_URL}/api/admin/insights/${INSIGHT_ID}`, {
    headers: {
      Authorization: `Bearer ${websiteEnv.ADMIN_API_SECRET}`,
      "Content-Type": "application/json"
    }
  });
  const detailJson = (await detail.json()) as { data?: { slug?: string } };
  const slug = detailJson.data?.slug ?? "insight-1788403880038";

  await page.goto(`${SITE_URL}/insight/${slug}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.locator(".block-wysiwyg p").first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const publicIndex = await page.locator(".block-wysiwyg p").evaluateAll((nodes) => {
    let best = 0;
    let bestLen = -1;
    nodes.forEach((node, index) => {
      const len = (node.textContent ?? "").length;
      if (len > bestLen) {
        best = index;
        bestLen = len;
      }
    });
    return best;
  });
  const publicShot = resolve(OUT, "public.png");
  await page.locator(".block-wysiwyg p").nth(publicIndex).screenshot({ path: publicShot });
  const pub = await readParagraph(page, `.block-wysiwyg p >> nth=${publicIndex}`);
  const publicRoot = await page.locator(".block-wysiwyg").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const p = el.querySelector("p");
    return {
      width: Math.round(el.getBoundingClientRect().width * 10) / 10,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      pWidth: p ? Math.round(p.getBoundingClientRect().width * 10) / 10 : null
    };
  });

  await browser.close();

  const endsMatch =
    editor.lineCount === pub.lineCount &&
    editor.lines.every((line, i) => line.end === (pub.lines[i]?.end ?? "") && line.start === (pub.lines[i]?.start ?? ""));

  const report = {
    slug,
    editorRoot,
    publicRoot,
    editor,
    public: pub,
    lineCountSame: editor.lineCount === pub.lineCount,
    breakCharsSame: endsMatch,
    screenshots: { editor: editorShot, public: publicShot }
  };
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!endsMatch) {
    console.error("LINE_BREAK_MISMATCH");
    process.exit(2);
  }
  console.log("VISUAL_OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
