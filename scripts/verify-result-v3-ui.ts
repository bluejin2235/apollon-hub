/**
 * 임계값 변경 후 UI 채팅 응답 시간 측정
 * npx tsx scripts/verify-result-v3-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";

const QUESTIONS = [
  "롯데타워 1차 아이데이션 자료 찾아줘",
  "인스파이어 시즌3 수행계획서 어디 있어",
  "WTCS 무역센터 건 어떻게 돼가",
  "작년 미디어파사드 자료 모아줘",
  "병가 며칠 쓸 수 있어"
];

function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

type ProfileRow = { id: string; email: string | null; role: string | null };

async function pickLunaUser(admin: SupabaseClient): Promise<ProfileRow> {
  const { data: beta, error } = await admin
    .from("luna_beta_access")
    .select("profile_id")
    .limit(20);
  if (error) throw error;
  const ids = ((beta ?? []) as { profile_id: string }[])
    .map((r) => r.profile_id)
    .filter(Boolean);
  if (ids.length === 0) {
    const { data: supers } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("role", "슈퍼관리자")
      .limit(1);
    const row = (supers ?? [])[0] as ProfileRow | undefined;
    if (row?.email) return row;
    throw new Error("luna beta / 슈퍼관리자 없음");
  }
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, email, role")
    .in("id", ids)
    .limit(5);
  if (pErr) throw pErr;
  const hit = ((profiles ?? []) as ProfileRow[]).find((p) => p.email);
  if (!hit?.email) throw new Error("luna 사용자 이메일 없음");
  return hit;
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
    throw new Error(`generateLink: ${linkErr?.message ?? "no token"}`);
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) {
    throw new Error(`verifyOtp: ${error?.message ?? "no session"}`);
  }
  return data.session;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("Missing supabase env");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await pickLunaUser(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  console.log(`UI: ${BASE_URL}/luna`);
  console.log(`User role: ${user.role ?? "-"}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
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

  await page.goto(`${BASE_URL}/luna`, { waitUntil: "networkidle", timeout: 120_000 });

  const results: {
    q: string;
    durationText: string | null;
    wallMs: number;
    hasRecommended: boolean;
    hasNasOnly: boolean;
    hasNotionOnly: boolean;
    hasLowBanner: boolean;
    midCount: number;
  }[] = [];

  for (const q of QUESTIONS) {
    const newBtn = page.getByRole("button", { name: "새 대화" }).first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }

    const input = page.locator("textarea").last();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    await input.fill(q);

    const send = page.getByRole("button", { name: "전송" });
    const t0 = Date.now();
    await send.click();

    // 하단 응답 시간(초) — 스트리밍 완료 신호
    await page.waitForFunction(
      () => /\d+\.\d+초/.test(document.body.innerText),
      { timeout: 180_000 }
    );
    await page.waitForTimeout(800);
    const wallMs = Date.now() - t0;
    const body = await page.locator("body").innerText();
    const durMatch = body.match(/(\d+\.\d+)초/g);
    const lastDur = durMatch?.[durMatch.length - 1] ?? null;
    results.push({
      q,
      durationText: lastDur,
      wallMs,
      hasRecommended: body.includes("추천 자료"),
      hasNasOnly: body.includes("노션 기록 없음"),
      hasNotionOnly: body.includes("Work서버 폴더 없음"),
      hasLowBanner: body.includes("확실한 자료를 못 찾았어요"),
      midCount: (body.match(/관련이 약한 자료/g) || []).length
    });
    console.log(
      `Q: ${q}\n  UI ${lastDur ?? "—"} · wall ${(wallMs / 1000).toFixed(1)}s · rec=${results[results.length - 1]!.hasRecommended} nasOnly=${results[results.length - 1]!.hasNasOnly} notionOnly=${results[results.length - 1]!.hasNotionOnly} low=${results[results.length - 1]!.hasLowBanner}\n`
    );
  }

  await browser.close();
  console.log("=== SUMMARY ===");
  for (const r of results) {
    console.log(
      `${r.durationText ?? "?"}\t${(r.wallMs / 1000).toFixed(1)}s\t${r.q}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
