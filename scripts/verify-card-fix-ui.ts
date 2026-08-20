/**
 * 자료 카드 경고·날짜·UI 응답시간 검증
 * npx tsx scripts/verify-card-fix-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseTitleDateLabel } from "../lib/luna/source-pack";

const BASE_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const Q = "롯데타워 1차 아이데이션 자료 찾아줘";

function projectRefFromUrl(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

type ProfileRow = { id: string; email: string | null; role: string | null };

async function pickLunaUser(admin: SupabaseClient): Promise<ProfileRow> {
  const { data: beta } = await admin
    .from("luna_beta_access")
    .select("profile_id")
    .limit(20);
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
    throw new Error("no user");
  }
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, role")
    .in("id", ids)
    .limit(5);
  const hit = ((profiles ?? []) as ProfileRow[]).find((p) => p.email);
  if (!hit?.email) throw new Error("no email");
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
  console.log("unit date:", parseTitleDateLabel("20240320 롯데타워 …"));
  console.log("unit date6:", parseTitleDateLabel("251209 서울스카이"));
  console.log("unit bad:", parseTitleDateLabel("abc"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await pickLunaUser(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, user.email!);
  const storageKey = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  await page.goto(`${BASE_URL}/luna`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });

  const newBtn = page.getByRole("button", { name: "새 대화" }).first();
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    await page.waitForTimeout(500);
  }

  const input = page.locator("textarea").last();
  await input.fill(Q);
  const t0 = Date.now();
  await page.getByRole("button", { name: "전송" }).click();
  await page.waitForFunction(
    () => /\d+\.\d+초/.test(document.body.innerText),
    { timeout: 180_000 }
  );
  await page.waitForTimeout(1000);
  const wallMs = Date.now() - t0;
  const body = await page.locator("body").innerText();

  // 자세히 열어 단계 ms
  const detail = page.getByRole("button", { name: "자세히" });
  if (await detail.isVisible().catch(() => false)) {
    await detail.click();
    await page.waitForTimeout(300);
  }
  const body2 = await page.locator("body").innerText();

  const durs = body.match(/(\d+\.\d+)초/g) ?? [];
  const lastDur = durs[durs.length - 1] ?? null;
  const hasWrongWarn =
    body.includes("Work서버 폴더 없음") &&
    /T:\\01 사업개발/.test(body);
  const hasFolderNoneAlone =
    body.includes("Work서버 폴더 없음") && !/T:\\/.test(body);
  const hasBadDate = body.includes("2020.24.03");
  const hasGoodDate = body.includes("2024.03.20");
  const stepLines = body2
    .split("\n")
    .filter((l) => /\d+ms/.test(l))
    .slice(0, 20);

  console.log("\n=== UI ===");
  console.log("Q:", Q);
  console.log("duration:", lastDur, "wall:", (wallMs / 1000).toFixed(1) + "s");
  console.log("badDate 2020.24.03:", hasBadDate);
  console.log("goodDate 2024.03.20:", hasGoodDate);
  console.log("warn+path contradiction:", hasWrongWarn);
  console.log("folder-none alone:", hasFolderNoneAlone);
  console.log("recommended:", body.includes("추천 자료"));
  console.log("steps with ms:");
  for (const l of stepLines) console.log(" ", l.trim());

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
