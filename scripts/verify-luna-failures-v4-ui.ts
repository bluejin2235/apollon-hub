/**
 * 실패 수집 v4 — 카드 간소화·대화 팝업 스크린샷
 * npx tsx scripts/verify-luna-failures-v4-ui.ts
 */
import { config } from "dotenv";
import { mkdirSync } from "fs";
import { join, resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "docs", "audit", "highlight-screens");

function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

type ProfileRow = { id: string; email: string | null; role: string | null };

async function pickSuperAdmin(admin: SupabaseClient): Promise<ProfileRow> {
  const { data: supers } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("role", "슈퍼관리자")
    .limit(5);
  const row = ((supers ?? []) as ProfileRow[]).find((r) => r.email);
  if (!row?.email) throw new Error("슈퍼관리자 없음");
  return row;
}

async function createSession(
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
  email: string
) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const mock = join(process.cwd(), "docs", "luna-mockups", "luna-failures-v4.html");
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    await page.goto(`file:///${mock.replace(/\\/g, "/")}`);
    await page.screenshot({
      path: join(OUT, "luna-failures-v4-mockup.png"),
      fullPage: true
    });
    console.log("✓ luna-failures-v4-mockup.png");
    await page.close();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.warn("env missing — live UI skip");
    await browser.close();
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await pickSuperAdmin(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: storageKey,
      value: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user
      }
    }
  );

  const url = `${BASE_URL}/settings?tab=luna&luna=failures`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText();
  const checks: Array<[string, boolean]> = [
    ["질문+사유 카피", bodyText.includes("카드를 누르면 그때 대화를 볼 수 있어요")],
    [
      "종류 탭(+정기 점검)",
      bodyText.includes("사람이 표시") &&
        bodyText.includes("자동 감지") &&
        bodyText.includes("정기 점검")
    ],
    ["개선하기 버튼", bodyText.includes("개선하기")],
    ["원인으로 묶기", bodyText.includes("원인으로 묶기")],
    [
      "질문 묶어보기 없음",
      !bodyText.includes("묶어 보기") && !bodyText.includes("비슷한 질문")
    ],
    ["전체에서 점검 제외 안내", bodyText.includes("정기 점검을 넣지 않습니다")],
    ["답변 excerpt 힌트 없음", !bodyText.includes("행을 누르면 그 대화로 갑니다")]
  ];
  for (const [name, ok] of checks) {
    console.log(ok ? `✓ ${name}` : `✗ ${name}`);
  }

  await page.screenshot({
    path: join(OUT, "luna-failures-dedupe-list.png"),
    fullPage: true
  });
  console.log("✓ luna-failures-dedupe-list.png");

  const causeBtn = page.getByRole("button", { name: /보기|선택됨/ }).first();
  if ((await causeBtn.count()) > 0) {
    const beforeCards = (await page.locator("text=눌러서 대화 보기").count());
    await causeBtn.click();
    await page.waitForTimeout(400);
    const filteredText = await page.locator("body").innerText();
    const afterCards = await page.locator("text=눌러서 대화 보기").count();
    console.log(
      filteredText.includes("선택됨") && filteredText.includes("전체 보기")
        ? "✓ 묶음 클릭 → 선택됨·전체 보기"
        : "✗ 묶음 클릭 필터 표시 없음"
    );
    console.log(
      afterCards <= beforeCards
        ? `✓ 필터 후 카드 ${afterCards}건 (이전 ${beforeCards})`
        : `✗ 필터 후 카드가 줄지 않음 ${afterCards} vs ${beforeCards}`
    );
    await page.screenshot({
      path: join(OUT, "luna-failures-cause-filter.png"),
      fullPage: true
    });
    console.log("✓ luna-failures-cause-filter.png");
    const clear = page.getByRole("button", { name: "전체 보기" });
    if ((await clear.count()) > 0) await clear.click();
    await page.waitForTimeout(300);
  }

  // 정기 점검 탭
  const inspectTab = page.getByRole("button", { name: /정기 점검/ });
  if ((await inspectTab.count()) > 0) {
    await inspectTab.first().click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: join(OUT, "luna-failures-inspect-tab.png"),
      fullPage: true
    });
    console.log("✓ luna-failures-inspect-tab.png");
    await page.getByRole("button", { name: /^전체/ }).first().click();
    await page.waitForTimeout(500);
  }

  // 자동 감지 탭에서 🌙 사유
  const autoTab = page.getByRole("button", { name: /자동 감지/ });
  if ((await autoTab.count()) > 0) {
    await autoTab.first().click();
    await page.waitForTimeout(800);
    const autoText = await page.locator("body").innerText();
    console.log(
      autoText.includes("🌙") || autoText.includes("왜 아쉬웠나") || !autoText.includes("사유 없음")
        ? "✓ 자동감지 사유 표시(또는 사유없음 감소)"
        : "! 자동감지 사유 확인 필요"
    );
    await page.screenshot({
      path: join(OUT, "luna-failures-auto-note.png"),
      fullPage: true
    });
    console.log("✓ luna-failures-auto-note.png");
  }

  const card = page.locator("text=눌러서 대화 보기").first();
  if ((await card.count()) > 0) {
    await card.click({ force: true });
    await page.waitForTimeout(1500);
    const afterUrl = page.url();
    console.log(afterUrl.includes("/luna?") ? "✗ 페이지가 /luna 로 이동함" : "✓ 페이지 이동 없음");
    const popupText = await page.locator("body").innerText();
    console.log(
      popupText.includes("여기서 아쉬웠다") || popupText.includes("이 답변에 표시했습니다")
        ? "✓ 팝업 대화 구분선"
        : "✗ 팝업 대화 구분선 없음"
    );
    await page.screenshot({
      path: join(OUT, "luna-failures-v4-popup.png"),
      fullPage: true
    });
    console.log("✓ luna-failures-v4-popup.png");

    const overlay = page.locator("div.fixed.inset-0");
    const improve = overlay.getByRole("button", { name: "개선하기" });
    if (await improve.count()) {
      await improve.click();
      await page.waitForTimeout(400);
      const improveOpen = (await page.locator("body").innerText()).includes("이렇게 했어야 해요");
      console.log(improveOpen ? "✓ 팝업 안 개선하기" : "✗ 팝업 안 개선하기");
      await page.screenshot({
        path: join(OUT, "luna-failures-v4-improve.png")
      });
      console.log("✓ luna-failures-v4-improve.png");
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closed = !(await page.locator("body").innerText()).includes("여기서 아쉬웠다");
    console.log(closed ? "✓ ESC 닫힘" : "✗ ESC 닫힘 실패");
  } else {
    console.log("! 카드 없음 — 팝업 클릭 스킵");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
