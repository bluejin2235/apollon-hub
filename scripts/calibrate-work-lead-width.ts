/**
 * 워크 기본 설명 — 15px 편집기 폭을 공개 줄바꿈에 맞게 탐색
 * npx tsx scripts/calibrate-work-lead-width.ts
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
  await context.addCookies([{ name: key, value: packed, url: HUB_URL, sameSite: "Lax" as const }]);
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

function measureWraps() {
  return (el: Element) => {
    const p = (el.querySelector("p") || el) as HTMLElement;
    const range = document.createRange();
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const map: { node: Text; offset: number }[] = [];
    let full = "";
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const t = n.textContent || "";
      for (let i = 0; i < t.length; i++) map.push({ node: n, offset: i });
      full += t;
    }
    const lines: string[] = [];
    let cur = "";
    let lastTop: number | null = null;
    for (let i = 0; i < map.length; i++) {
      const { node, offset } = map[i]!;
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        cur += full[i]!;
        continue;
      }
      if (lastTop === null) lastTop = rect.top;
      if (Math.abs(rect.top - lastTop) > 2) {
        lines.push(cur);
        cur = full[i]!;
        lastTop = rect.top;
      } else {
        cur += full[i]!;
      }
    }
    if (cur) lines.push(cur);
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      boxWidth: Math.round(r.width * 10) / 10,
      lineCount: lines.length,
      lines,
      ends: lines.map((l) => l.slice(-12))
    };
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
  const pub = await page.locator(".content__body").first().evaluate(measureWraps());
  const plainHtml = `<p>${pub.lines.join("").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;

  await page.goto(`${HUB_URL}/website/works/${WORK_ID}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForSelector(".lead-drop", { timeout: 60_000 });
  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead", { timeout: 15_000 });

  const ratioW = Math.round(831.4 * (15 / 20) * 10) / 10; // 623.6
  const trials: number[] = [];
  for (let w = Math.floor(ratioW) - 8; w <= Math.ceil(ratioW) + 20; w++) trials.push(w);

  const results: unknown[] = [];
  let best: { width: number; endsMatch: boolean; lineCountMatch: boolean; ends: string[] } | null =
    null;

  for (const width of trials) {
    const ed = await page.locator(".rte-ed--work-lead").first().evaluate(
      (el, args: { width: number; html: string }) => {
        const node = el as HTMLElement;
        node.style.setProperty("font-size", "15px", "important");
        node.style.setProperty("line-height", "23px", "important");
        node.style.setProperty("width", `${args.width}px`, "important");
        node.style.setProperty("min-width", `${args.width}px`, "important");
        node.style.setProperty("max-width", `${args.width}px`, "important");
        node.style.setProperty("overflow-wrap", "normal", "important");
        node.style.setProperty("word-break", "normal", "important");
        node.innerHTML = args.html;
        const p = (node.querySelector("p") || node) as HTMLElement;
        const range = document.createRange();
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const map: { node: Text; offset: number }[] = [];
        let full = "";
        while (walker.nextNode()) {
          const n = walker.currentNode as Text;
          const t = n.textContent || "";
          for (let i = 0; i < t.length; i++) map.push({ node: n, offset: i });
          full += t;
        }
        const lines: string[] = [];
        let cur = "";
        let lastTop: number | null = null;
        for (let i = 0; i < map.length; i++) {
          const { node: tn, offset } = map[i]!;
          range.setStart(tn, offset);
          range.setEnd(tn, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            cur += full[i]!;
            continue;
          }
          if (lastTop === null) lastTop = rect.top;
          if (Math.abs(rect.top - lastTop) > 2) {
            lines.push(cur);
            cur = full[i]!;
            lastTop = rect.top;
          } else {
            cur += full[i]!;
          }
        }
        if (cur) lines.push(cur);
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return {
          width: args.width,
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          boxWidth: Math.round(r.width * 10) / 10,
          lineCount: lines.length,
          lines,
          ends: lines.map((l) => l.slice(-12))
        };
      },
      { width, html: plainHtml }
    );

    const endsMatch = JSON.stringify(ed.ends) === JSON.stringify(pub.ends);
    const lineCountMatch = ed.lineCount === pub.lineCount;
    const row = { ...ed, endsMatch, lineCountMatch };
    results.push(row);
    if (endsMatch && lineCountMatch) {
      best = { width, endsMatch, lineCountMatch, ends: ed.ends };
      break;
    }
    if (!best && lineCountMatch) {
      best = { width, endsMatch, lineCountMatch, ends: ed.ends };
    }
  }

  const report = {
    public: pub,
    ratioWidth: ratioW,
    best,
    results
  };
  writeFileSync(resolve(OUT, "calibrate-work-lead-width.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ publicEnds: pub.ends, ratioW, best, hitCount: results.length }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
