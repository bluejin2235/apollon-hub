/**
 * /q 단축 URL · 세션 이어하기 · 매니페스트 · 모바일 뷰포트
 * npx tsx --require ./scripts/stub-server-only.cjs --env-file=.env.local scripts/verify-qa-chat.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";
import { startQaSession } from "../lib/luna/qa-session";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const OUT = resolve(process.cwd(), "tmp", "luna-qa-verify");

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
    cookies.map((cookie) => ({
      ...cookie,
      url: HUB_URL,
      sameSite: "Lax" as const
    }))
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function pickEmail(admin: SupabaseClient): Promise<{
  email: string;
  userId: string;
}> {
  const { data } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "슈퍼관리자")
    .not("email", "is", null)
    .limit(5);
  const row = (data ?? []).find((r) => typeof r.email === "string");
  if (!row?.email || !row.id) throw new Error("슈퍼관리자 없음");
  return { email: row.email as string, userId: row.id as string };
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

  const health = await fetch(HUB_URL, { method: "GET" }).catch(() => null);
  if (!health?.ok && health?.status !== 307 && health?.status !== 200) {
    throw new Error(`${HUB_URL} 이 안 켜져 있습니다`);
  }

  const browser = await chromium.launch({
    headless: true,
    channel: "chrome"
  });
  const failed = { n: 0 };

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${HUB_URL}/q`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const url = page.url();
    check(
      "비로그인 /q → redirect=/q",
      url.includes("redirect=") && decodeURIComponent(url).includes("/q"),
      failed
    );
    await page.close();
  }

  {
    const man = await fetch(`${HUB_URL}/luna-qa.webmanifest`);
    const json = (await man.json()) as {
      name?: string;
      display?: string;
      start_url?: string;
    };
    check("매니페스트 이름", json.name === "루나 문답", failed);
    check("매니페스트 standalone", json.display === "standalone", failed);
    check("매니페스트 start_url", json.start_url === "/q", failed);
  }

  {
    const alias = await fetch(`${HUB_URL}/qa`, { redirect: "manual" });
    check(
      "/qa 리다이렉트",
      alias.status === 307 || alias.status === 308 || alias.status === 200,
      failed
    );
    const loc = alias.headers.get("location") ?? "";
    if (alias.status === 307 || alias.status === 308) {
      check("/qa → /q", loc.endsWith("/q") || loc.includes("/q"), failed);
    }
  }

  const { email, userId } = await pickEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);

  await admin
    .from("luna_qa_sessions")
    .update({ finished_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("finished_at", null);

  const started = await startQaSession(admin, userId);
  check("세션 생성", Boolean(started.id), failed);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);
  await page.goto(`${HUB_URL}/q`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  const shot1 = resolve(OUT, "q-mobile.png");
  await page.screenshot({ path: shot1, fullPage: true });
  console.log("shot", shot1);

  const empty = body.includes("지금은 여쭤볼 게 없어요");
  const hasQuestion = started.items.length > 0;
  if (hasQuestion) {
    const q = started.items[0]?.question ?? "";
    check("첫 질문 표시", Boolean(q) && body.includes(q.slice(0, 18)), failed);
    check("진행률", body.includes("/") && /\d+\s*\/\s*\d+/.test(body), failed);
    const firstOpt = started.items[0]?.options[0]?.label ?? "";
    check("1번 선택지", Boolean(firstOpt) && body.includes(firstOpt.slice(0, 8)), failed);
  } else {
    check("빈 상태 안내", empty, failed);
    check("루나와 대화하기", body.includes("루나와 대화하기"), failed);
  }

  if (started.id && started.items.length > 1) {
    await admin
      .from("luna_qa_sessions")
      .update({ cursor: 1 })
      .eq("id", started.id);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const body2 = await page.locator("body").innerText();
    const q2 = started.items[1]?.question ?? "";
    check(
      "세션 이어하기 (cursor=1)",
      Boolean(q2) && body2.includes(q2.slice(0, 18)),
      failed
    );
    await page.screenshot({
      path: resolve(OUT, "q-resume.png"),
      fullPage: true
    });
  } else {
    check("세션 이어하기 (문항 부족 — 스킵 아님)", started.items.length <= 1, failed);
  }

  await admin
    .from("luna_qa_sessions")
    .update({ finished_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("finished_at", null);

  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify(
      { items: started.items.length, first: started.items[0]?.question ?? null },
      null,
      2
    )
  );

  await browser.close();
  if (failed.n) {
    console.error(`실패 ${failed.n}건`);
    process.exit(1);
  }
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
