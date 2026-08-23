/**
 * 실패 수집 — 원인 묶음 클릭 필터 검증
 * npx tsx scripts/verify-failure-cause-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("env missing");
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await pickSuperAdmin(admin);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email!
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
  const session = data.session;
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  const browser = await chromium.launch({ headless: true });
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

  await page.goto(`${BASE_URL}/settings?tab=luna&luna=failures`, {
    waitUntil: "networkidle",
    timeout: 60000
  });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText();
  const checks: Array<[string, boolean]> = [
    ["원인으로 묶기", bodyText.includes("원인으로 묶기")],
    ["검색이 문서를 못 찾음", bodyText.includes("검색이 문서를 못 찾음")],
    ["보기 버튼", bodyText.includes("보기")],
    ["질문 묶어보기 없음", !bodyText.includes("묶어 보기")],
    ["비슷한 질문 묶음 없음", !bodyText.includes("비슷한 질문")]
  ];
  let failed = false;
  for (const [name, ok] of checks) {
    console.log(ok ? `✓ ${name}` : `✗ ${name}`);
    if (!ok) failed = true;
  }

  const viewBtn = page.locator("button", { hasText: "보기" }).first();
  if ((await viewBtn.count()) > 0) {
    const before = await page.locator("text=눌러서 대화 보기").count();
    await viewBtn.first().click();
    await page.waitForTimeout(500);
    const afterText = await page.locator("body").innerText();
    const after = await page.locator("text=눌러서 대화 보기").count();
    const filterOk =
      afterText.includes("선택됨") && afterText.includes("전체 보기");
    console.log(filterOk ? "✓ 클릭 후 선택됨·전체 보기" : "✗ 필터 표시 없음");
    console.log(
      after <= before
        ? `✓ 카드 ${before} → ${after}`
        : `✗ 카드가 줄지 않음 ${before} → ${after}`
    );
    if (!filterOk) failed = true;
  } else {
    console.log("! 보기 버튼 없음 (원인 묶음 0건?)");
  }

  await browser.close();
  if (failed) process.exit(1);
  console.log("OK cause UI");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
