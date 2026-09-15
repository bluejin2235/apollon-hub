/**
 * LUNA 관리자 어드민 신설 검증
 * npx tsx scripts/verify-luna-admin.ts
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
const OUT = resolve(process.cwd(), "tmp", "luna-admin-verify");

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

async function pickEmail(
  admin: SupabaseClient,
  role: "슈퍼관리자" | "멤버"
): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("role", role)
    .not("email", "is", null)
    .limit(5);
  const email = (data ?? []).find((r) => typeof r.email === "string")?.email;
  if (!email) throw new Error(`${role} 없음`);
  return email as string;
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

  const browser = await chromium.launch({
    headless: true,
    channel: "chrome"
  });
  const failed = { n: 0 };

  {
    const email = await pickEmail(admin, "슈퍼관리자");
    const session = await createSession(admin, anonKey, supabaseUrl, email);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const page = await context.newPage();
    await login(context, page, session, supabaseUrl);

    await page.goto(`${HUB_URL}/settings`, {
      waitUntil: "networkidle",
      timeout: 90_000
    });
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText();
    check("슈퍼관리자 /settings → LUNA 관리자", text.includes("LUNA 관리자"), failed);
    check("메뉴 대시보드", text.includes("대시보드"), failed);
    check("메뉴 지식", /지식/.test(text), failed);
    check("메뉴 대화", text.includes("대화"), failed);
    check("메뉴 자습", text.includes("자습"), failed);
    check("메뉴 실패 수집", text.includes("실패 수집"), failed);
    check("메뉴 지식후보", text.includes("지식후보"), failed);
    check("메뉴 두뇌", text.includes("두뇌"), failed);
    check("신호등 수집", text.includes("수집"), failed);
    check("신호등 학습", text.includes("학습"), failed);
    check("신호등 확정", text.includes("확정"), failed);
    check("신호등 적용", text.includes("적용"), failed);
    await page.screenshot({ path: resolve(OUT, "01-super-dashboard.png"), fullPage: true });

    await page.getByRole("button", { name: "지식", exact: true }).click();
    await page.getByText("원천별 상세").waitFor({ timeout: 30_000 });
    const kText = await page.locator("body").innerText();
    check("지식 › 1차 데이터", kText.includes("1차 데이터"), failed);
    check("지식 › 2차 데이터", kText.includes("2차 데이터"), failed);
    check("1차 원천 표", kText.includes("Work서버") && kText.includes("노션"), failed);
    await page.screenshot({ path: resolve(OUT, "02-super-knowledge.png"), fullPage: true });

    await page.getByRole("button", { name: "2차 데이터", exact: true }).click();
    await page.getByRole("button", { name: /같은 것/ }).waitFor({ timeout: 15_000 });
    const sText = await page.locator("body").innerText();
    check("2차 칩 같은 것", sText.includes("같은 것"), failed);
    check("2차 칩 속한 것", sText.includes("속한 것"), failed);
    check("2차 칩 이어진 것", sText.includes("이어진 것"), failed);

    await page.getByRole("button", { name: "자습", exact: true }).click();
    await page.waitForTimeout(1500);
    const st = await page.locator("body").innerText();
    check("자습 › 오늘 밤 할 일", st.includes("오늘 밤 할 일"), failed);
    check("자습 › 2차 데이터 만들기", st.includes("2차 데이터 만들기"), failed);
    await page.screenshot({ path: resolve(OUT, "03-super-tonight.png"), fullPage: true });

    await page.getByRole("button", { name: /실패 수집/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "루나의 분석", exact: true }).click();
    await page.waitForTimeout(2000);
    const fText = await page.locator("body").innerText();
    check("실패 › 루나의 분석", fText.includes("루나의 분석") || fText.includes("공통 원인") || fText.includes("분석 결과"), failed);

    await page.getByRole("button", { name: /지식후보/ }).click();
    await page.waitForTimeout(1200);
    const cText = await page.locator("body").innerText();
    check("지식후보 › 충돌", cText.includes("충돌"), failed);

    await page.getByRole("button", { name: "대기 후보", exact: true }).click();
    await page.getByRole("button", { name: /루나의 질문/ }).click();
    await page.waitForTimeout(1500);
    const qText = await page.locator("body").innerText();
    check(
      "2차 판정은 같은 것으로 안내",
      /2차 데이터 판정/.test(qText) && qText.includes("같은 것에서 보기"),
      failed
    );
    check("지식후보에 같은 것 좌우 카드 없음", (await page.locator(".luna-admin .pair").count()) === 0, failed);
    await page.screenshot({ path: resolve(OUT, "03b-questions.png"), fullPage: true });

    await page.getByRole("button", { name: "두뇌", exact: true }).click();
    await page.waitForTimeout(1500);
    const bText = await page.locator("body").innerText();
    check("두뇌 › 프롬프트", bText.includes("프롬프트"), failed);

    await page.goto(`${HUB_URL}/settings?tab=luna`, {
      waitUntil: "networkidle",
      timeout: 90_000
    });
    await page.waitForTimeout(2500);
    const legacy = await page.locator("body").innerText();
    check("기존 LUNA 탭 유지 (tab=luna)", legacy.includes("대시보드") && !legacy.includes("1차 데이터"), failed);
    await page.screenshot({ path: resolve(OUT, "04-legacy-luna.png"), fullPage: true });

    await context.close();
  }

  {
    const email = await pickEmail(admin, "멤버");
    const session = await createSession(admin, anonKey, supabaseUrl, email);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(context, page, session, supabaseUrl);
    await page.goto(`${HUB_URL}/settings`, {
      waitUntil: "networkidle",
      timeout: 90_000
    });
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText();
    check("멤버 /settings → 기존 설정", text.includes("프로필") && !text.includes("LUNA 관리자"), failed);
    check("멤버에게 LUNA 탭 없음", !text.includes("실패 수집"), failed);
    await page.screenshot({ path: resolve(OUT, "05-member-settings.png"), fullPage: true });
    await context.close();
  }

  await browser.close();
  if (failed.n > 0) {
    console.log(`FAILED ${failed.n}`);
    process.exit(1);
  }
  console.log("OK luna-admin");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
