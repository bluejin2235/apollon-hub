/**
 * 인사이트 본문 — 공개 vs 팝업 편집기 줄바꿈·간격 실측
 * npx tsx scripts/compare-insight-body-wrap.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL =
  process.env.SITE_URL ?? websiteEnv.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const INSIGHT_SLUG = "insight-1788401143052";
const INSIGHT_ID = "bbdfef0f-ea89-4785-ab9d-916065544b34";
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

type WrapInfo = {
  fontSize: string;
  lineHeight: string;
  marginTop: string;
  width: number;
  lineCount: number;
  lineTexts: string[];
  breakEndChars: string[];
  text: string;
};

async function measureP(page: Page, selector: string): Promise<WrapInfo> {
  return page.locator(selector).first().evaluate((node) => {
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNode = walk.nextNode();
    const text = textNode?.textContent ?? el.textContent ?? "";
    const range = document.createRange();
    const lines: { top: number; chars: string }[] = [];
    if (textNode) {
      for (let i = 0; i < text.length; i++) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const top = Math.round(r.top);
        const last = lines[lines.length - 1];
        if (!last || last.top !== top) lines.push({ top, chars: text[i]! });
        else last.chars += text[i]!;
      }
    }
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      marginTop: cs.marginTop,
      width: el.getBoundingClientRect().width,
      lineCount: Math.max(lines.length, 1),
      lineTexts: lines.map((l) => l.chars),
      breakEndChars: lines.map((l) => l.chars.slice(-1)),
      text: text.slice(0, 160)
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

  // —— 공개 ——
  await page.goto(`${SITE_URL}/insight/${INSIGHT_SLUG}`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForTimeout(1200);
  await page.locator(".block-wysiwyg p").first().waitFor({ timeout: 30_000 });

  const publicShell = await page.locator(".block-wysiwyg").first().evaluate((el) => {
    const p = el.querySelector("p");
    return {
      blockWidth: el.getBoundingClientRect().width,
      pWidth: p?.getBoundingClientRect().width ?? null,
      gapVar: getComputedStyle(el).getPropertyValue("--gap-p-p").trim()
    };
  });
  const publicP1 = await measureP(page, ".block-wysiwyg p");
  // 줄바꿈 비교용 — 3줄 문단 (index 3)
  const publicLong = await measureP(page, ".block-wysiwyg p >> nth=3");
  const publicP2 = await measureP(page, ".block-wysiwyg p + p");

  await page.locator(".block-wysiwyg").first().screenshot({
    path: resolve(OUT, "compare-public-insight-body-1920.png")
  });

  // —— 어드민 팝업 ——
  await login(context, page, session, supabaseUrl);
  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(4000);
  await page.locator(".wa").first().waitFor({ timeout: 60_000 });
  await page.waitForSelector(".insight-blks .blk", { timeout: 60_000 });

  // 글 블록 펼친 뒤 드롭존 클릭 → 팝업
  const textBlk = page
    .locator(".insight-blks .blk")
    .filter({ hasText: /글|에디터|본문/ })
    .first();
  if ((await textBlk.count()) === 0) {
    // 첫 블록이라도 펼침
    await page.locator(".insight-blks .blk .bh").first().click();
  } else {
    if (!(await textBlk.locator(".bb").isVisible().catch(() => false))) {
      await textBlk.locator(".bh").click();
      await page.waitForTimeout(400);
    }
  }
  // 아직 lead-drop 없으면 모든 블록 헤더 클릭
  if ((await page.locator(".lead-drop").count()) === 0) {
    const headers = page.locator(".insight-blks .blk .bh");
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click();
      await page.waitForTimeout(200);
      if ((await page.locator(".lead-drop").count()) > 0) break;
    }
  }

  const drop = page.locator(".lead-drop").first();
  await drop.waitFor({ state: "visible", timeout: 30_000 });
  await drop.click();
  await page.waitForTimeout(1500);

  const rte = page.locator(".rte-ed--insight-body").first();
  await rte.waitFor({ state: "visible", timeout: 30_000 });

  // 공개와 같은 첫 문단 텍스트를 편집기에 맞춰 비교 (이미 같은 콘텐츠면 유지)
  const publicText = publicP1.text;
  await rte.evaluate((el, sampleStart) => {
    const p = el.querySelector("p");
    const t = (p?.textContent ?? "").slice(0, 160);
    // 측정만 — 내용이 비었을 때만 공개 샘플을 넣지 않고 그대로
    void sampleStart;
    void t;
  }, publicText);

  const editorRoot = await rte.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      width: el.getBoundingClientRect().width,
      className: el.className
    };
  });
  const editorP1 = await measureP(page, ".rte-ed--insight-body p");
  const editorLong = await measureP(page, ".rte-ed--insight-body p >> nth=3");
  const editorP2Count = await page.locator(".rte-ed--insight-body p + p").count();
  const editorP2 =
    editorP2Count > 0 ? await measureP(page, ".rte-ed--insight-body p + p") : null;

  const modal = page.locator(".lead-mw").first();
  if (await modal.count()) {
    await modal.screenshot({ path: resolve(OUT, "compare-editor-insight-body-1920.png") });
  } else {
    await rte.screenshot({ path: resolve(OUT, "compare-editor-insight-body-1920.png") });
  }

  await browser.close();

  const report = {
    public: {
      shell: publicShell,
      p1: publicP1,
      longP: publicLong,
      p2marginTop: publicP2.marginTop
    },
    editor: {
      root: editorRoot,
      p1: editorP1,
      longP: editorLong,
      p2marginTop: editorP2?.marginTop ?? null
    },
    wrapCompare: {
      publicLines: publicLong.lineCount,
      editorLines: editorLong.lineCount,
      publicBreakEnds: publicLong.breakEndChars,
      editorBreakEnds: editorLong.breakEndChars,
      publicLineTexts: publicLong.lineTexts,
      editorLineTexts: editorLong.lineTexts,
      sameLineCount: publicLong.lineCount === editorLong.lineCount,
      sameBreakChars:
        publicLong.breakEndChars.length === editorLong.breakEndChars.length &&
        publicLong.breakEndChars.every((c, i) => c === editorLong.breakEndChars[i]),
      sameLineTexts:
        publicLong.lineTexts.length === editorLong.lineTexts.length &&
        publicLong.lineTexts.every((t, i) => t === editorLong.lineTexts[i])
    },
    screenshots: {
      public: resolve(OUT, "compare-public-insight-body-1920.png"),
      editor: resolve(OUT, "compare-editor-insight-body-1920.png")
    }
  };

  writeFileSync(resolve(OUT, "compare-insight-body.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
