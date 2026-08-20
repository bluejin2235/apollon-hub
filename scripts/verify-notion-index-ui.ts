/**
 * 노션 색인 관리 화면 스크린샷
 * npx tsx scripts/verify-notion-index-ui.ts
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

  // 1) mockup reference
  const mock = join(process.cwd(), "docs", "luna-mockups", "luna-notion-index.html");
  const browser = await chromium.launch({ headless: true });
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
    await page.goto(`file:///${mock.replace(/\\/g, "/")}`);
    await page.screenshot({
      path: join(OUT, "notion-index-mockup.png"),
      fullPage: true
    });
    console.log("✓ notion-index-mockup.png");
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

  const url = `${BASE_URL}/settings?tab=luna&luna=knowledge&sub=notion`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  const bodyText = await page.locator("body").innerText();
  const checks = [
    "언제 색인하나",
    "색인 이력",
    "색인에서 빼는 것",
    "지금 색인",
    "검색 규칙"
  ];
  for (const c of checks) {
    console.log(bodyText.includes(c) ? `✓ UI has: ${c}` : `✗ missing: ${c}`);
  }

  await page.screenshot({
    path: join(OUT, "notion-index-live.png"),
    fullPage: true
  });
  console.log("✓ notion-index-live.png");

  // API smoke: schedule round-trip
  const overviewRes = await page.request.get(`${BASE_URL}/api/luna/notion/overview`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  console.log("overview status", overviewRes.status());
  if (overviewRes.ok()) {
    const json = await overviewRes.json();
    console.log("schedule", JSON.stringify(json.schedule));
    console.log("stats pages", json.stats?.pages);
    console.log("history", json.history?.length ?? 0);

    const put = await page.request.put(`${BASE_URL}/api/luna/notion/schedule`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      data: {
        full: { enabled: true, time: "03:25" },
        incremental: { enabled: true, time: "13:35" }
      }
    });
    console.log("schedule put", put.status(), await put.text());
    const putBack = await page.request.put(`${BASE_URL}/api/luna/notion/schedule`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      data: {
        full: { enabled: true, time: "03:20" },
        incremental: { enabled: true, time: "13:30" }
      }
    });
    console.log("schedule restore", putBack.status());
  } else {
    console.log("overview body", (await overviewRes.text()).slice(0, 300));
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
