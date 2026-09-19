/**
 * 멤버 계정으로 용어·사례 응답 시간 실측
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/measure-member-answer-time.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const HUB = (
  process.env.LUNA_UI_BASE_URL ?? "https://hub.apollonworks.com"
).replace(/\/$/, "");

const QUERIES: Array<{ type: string; text: string }> = [
  { type: "term", text: "아폴론에서 「동선」이라고 하면 보통 무엇을 말해?" },
  { type: "term", text: "아폴론에서 「KV」라고 하면 보통 무엇을 포함해?" },
  {
    type: "case",
    text: "수원화성 전시처럼 역사 공간에 현대 동선을 얹은 사례 있어?"
  },
  {
    type: "case",
    text: "인스파이어 시즌4랑 비슷한 복합 동선 사례 더 있어?"
  }
];

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0]!;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(
    supabaseUrl,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // 멤버 · 공간기획 — 남은빈
  const email = "eb@apollonworks.com";
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "generateLink");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: sess, error: sErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email"
  });
  if (sErr || !sess.session) throw new Error(sErr?.message ?? "no session");
  const session = sess.session;
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const packed = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user
  };

  mkdirSync("tmp/persona-9x15", { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  const b64url = Buffer.from(JSON.stringify(packed))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const cookieVal = `base64-${b64url}`;
  await context.addCookies([
    { name: key, value: cookieVal, url: HUB, sameSite: "Lax" as const }
  ]);
  await page.goto(HUB, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, JSON.stringify(v)),
    { k: key, v: packed }
  );
  await page.goto(`${HUB}/luna`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForSelector("textarea", { timeout: 60_000 });
  const gate = await page.locator("textarea").last().isEnabled();
  if (!gate) {
    await page.screenshot({
      path: "tmp/persona-9x15/timing-gate-fail.png",
      fullPage: true
    });
    throw new Error("luna textarea not enabled");
  }

  const results = [];
  for (let i = 0; i < QUERIES.length; i += 1) {
    const q = QUERIES[i]!;
    if (i > 0) {
      const newBtn = page.getByRole("button", { name: "새 대화" }).first();
      if (await newBtn.isVisible().catch(() => false)) {
        await newBtn.click();
        await page.waitForTimeout(1000);
      }
    }
    const input = page.locator("textarea").last();
    await input.waitFor({ state: "visible", timeout: 60_000 });
    for (let w = 0; w < 30; w += 1) {
      if (await input.isEnabled()) break;
      await page.waitForTimeout(500);
    }
    await input.fill(q.text);
    const t0 = Date.now();
    const chatWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/luna/chat") &&
        res.request().method() === "POST",
      { timeout: 180_000 }
    );
    const send = page.getByRole("button", { name: "전송" }).first();
    if (await send.isVisible().catch(() => false)) await send.click();
    else await input.press("Enter");
    const res = await chatWait;
    const apiMs = Date.now() - t0;
    // 스트림 종료 후 메타 줄이 붙을 때까지 — textarea enabled
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(
            "textarea"
          ) as HTMLTextAreaElement | null;
          return Boolean(el) && !el!.disabled;
        },
        { timeout: 120_000 }
      )
      .catch(() => null);
    await page.waitForTimeout(600);
    const wallMs = Date.now() - t0;
    const uiSec = await page.evaluate(() => {
      const all = [
        ...document.body.innerText.matchAll(/(\d+(?:\.\d+)?)초/g)
      ];
      if (!all.length) return null;
      return Number(all[all.length - 1]![1]);
    });
    const bodyTail = (await page.locator("body").innerText()).slice(-200);
    results.push({
      type: q.type,
      text: q.text,
      apiStatus: res.status(),
      apiSec: +(apiMs / 1000).toFixed(1),
      wallSec: +(wallMs / 1000).toFixed(1),
      uiSec,
      bodyTail
    });
    console.log(JSON.stringify(results[results.length - 1]));
  }

  const byType: Record<string, number[]> = {};
  for (const r of results) {
    if (r.uiSec == null) continue;
    (byType[r.type] ??= []).push(r.uiSec);
  }
  const avg = (a: number[]) =>
    a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
  const summary = {
    email,
    role: "멤버",
    results,
    avgUi: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, avg(v)])
    )
  };
  writeFileSync(
    "tmp/persona-9x15/member-timing.json",
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
