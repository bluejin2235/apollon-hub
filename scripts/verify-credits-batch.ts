/**
 * 크레딧 일괄 저장 · 미저장 공개 경고 · 스냅샷 credits
 * npx tsx scripts/verify-credits-batch.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "9cb7ef5e-de15-411c-b1ea-561f7f7de13b";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=credits`;
const SITE_URL = (process.env.WEBSITE_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

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
  if (!email) throw new Error("no admin");
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
  if (linkErr || !link?.properties?.hashed_token) throw new Error(linkErr?.message ?? "no token");
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

async function login(context: BrowserContext, page: Page, session: Session, supabaseUrl: string) {
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

const FIVE = [
  { role: "Developer", ko: "GCCT 컨소시엄", en: "GCCT Consortium" },
  { role: "Client", ko: "트렌디유스", en: "Trendy Youth" },
  { role: "Media Design", ko: "아폴론", en: "Apollon" },
  { role: "Construction", ko: "시공사", en: "Builder" },
  { role: "Lighting", ko: "조명팀", en: "Lighting Team" }
];

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const siteSecret = websiteEnv.ADMIN_API_SECRET!;

  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const hubHeaders = {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json"
  };

  // restore baseline empty credits via batch API (clean diag leftovers)
  const clear = await fetch(`${HUB_URL}/api/website/works/${WORK_ID}/credits`, {
    method: "PUT",
    headers: hubHeaders,
    body: JSON.stringify({ items: [] })
  });
  const clearBody = await clear.text();
  if (clear.status !== 200) {
    throw new Error(`clear failed ${clear.status} ${clearBody}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const putBodies: Array<{ status: number; body: string; url: string }> = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/credits") || res.request().method() !== "PUT") return;
    try {
      putBodies.push({
        status: res.status(),
        body: (await res.text()).slice(0, 600),
        url: res.url()
      });
    } catch {
      putBodies.push({ status: res.status(), body: "", url: res.url() });
    }
  });

  await login(context, page, session, supabaseUrl);
  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });

  // remove any existing rows in UI
  for (;;) {
    const del = page.locator(".wa .cr .crb button").filter({ hasText: "×" }).first();
    if ((await del.count()) === 0) break;
    await del.click();
    await page.waitForTimeout(100);
  }

  for (const row of FIVE) {
    await page.getByRole("button", { name: "＋ 크레딧 추가" }).click();
    const last = page.locator(".wa .cr").last();
    await last.locator("input").nth(0).fill(row.role);
    await last.locator("input").nth(1).fill(row.ko);
    await last.locator("input").nth(2).fill(row.en);
  }

  const saveWait = page.waitForResponse(
    (res) => res.url().includes(`/works/${WORK_ID}/credits`) && res.request().method() === "PUT",
    { timeout: 30_000 }
  );
  await page.getByRole("button", { name: /부분 저장|저장할 것이 있습니다/ }).click();
  const saveRes = await saveWait;
  const saveText = await saveRes.text();
  const saveJson = JSON.parse(saveText) as { data?: { updated?: number }; error?: string };

  await page.waitForTimeout(1500);
  const { data: dbAfterSave } = await siteAdmin
    .from("work_credits")
    .select("role, name, sort")
    .eq("work_id", WORK_ID)
    .order("sort");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll(".wa .cr").length === 5, null, {
    timeout: 30_000
  });
  const rowsAfterReload = await page.locator(".wa .cr").count();

  // add unsaved 6th row then try publish
  await page.getByRole("button", { name: "＋ 크레딧 추가" }).click();
  const extra = page.locator(".wa .cr").last();
  await extra.locator("input").nth(0).fill("Extra");
  await extra.locator("input").nth(1).fill("미저장");
  await extra.locator("input").nth(2).fill("Unsaved");

  await page.getByRole("button", { name: "공개", exact: true }).click();
  const warnVisible = await page
    .getByText("저장하지 않은 변경이 있습니다. 저장하고 공개할까요?")
    .isVisible()
    .catch(() => false);

  // cancel warn — do not partial-save an emptied list (that wiped DB before)
  if (warnVisible) {
    await page.getByRole("button", { name: "취소" }).click();
  }

  // drop unsaved 6th row only; leave the five saved rows alone
  await page.locator(".wa .cr .crb button").filter({ hasText: "×" }).last().click();
  await page.waitForFunction(() => document.querySelectorAll(".wa .cr").length === 5, null, {
    timeout: 10_000
  });

  // publish via API to capture snapshot with credits (skip UI blockers)
  const publish = await fetch(`${SITE_URL}/api/admin/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${siteSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contentType: "work",
      contentId: WORK_ID,
      changeNote: "verify credits batch",
      skipChecks: true
    })
  });
  const publishBody = await publish.text();

  const { data: pub } = await siteAdmin
    .from("content_published")
    .select("version, snapshot")
    .eq("content_type", "work")
    .eq("content_id", WORK_ID)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snap = pub?.snapshot as { item?: { credits?: unknown[] } } | null;
  const snapCredits = snap?.item?.credits ?? null;

  // public page — publish revalidates; wait briefly then check
  await new Promise((r) => setTimeout(r, 1500));
  const publicPage = await context.newPage();
  await publicPage.goto(
    `${SITE_URL}/ko/works/trendyyouth-town-media-architecture-concept-design`,
    { waitUntil: "domcontentloaded", timeout: 120_000 }
  );
  await publicPage.waitForSelector(".work-credit", { timeout: 30_000 }).catch(() => null);
  const creditSection = publicPage.locator(".work-credit");
  const creditVisible = await creditSection.isVisible().catch(() => false);
  const creditRoles = creditVisible
    ? await creditSection.locator(".work-credit__role").allTextContents()
    : [];

  await browser.close();

  const report = {
    clearStatus: clear.status,
    save: {
      status: saveRes.status(),
      updated: saveJson.data?.updated ?? null,
      error: saveJson.error ?? null,
      body: saveText.slice(0, 400),
      putCount: putBodies.length,
      puts: putBodies
    },
    dbAfterSave,
    dbCount: dbAfterSave?.length ?? 0,
    rowsAfterReload,
    warnVisible,
    publish: { status: publish.status, body: publishBody.slice(0, 400) },
    snapshotVersion: pub?.version ?? null,
    snapshotCreditsCount: Array.isArray(snapCredits) ? snapCredits.length : null,
    snapshotHasCreditsKey: Array.isArray(snapCredits),
    public: { creditVisible, creditRoles }
  };
  console.log(JSON.stringify(report, null, 2));

  const ok =
    saveRes.status() === 200 &&
    (dbAfterSave?.length ?? 0) === 5 &&
    rowsAfterReload === 5 &&
    warnVisible &&
    Array.isArray(snapCredits) &&
    snapCredits.length === 5 &&
    creditVisible &&
    creditRoles.length === 5;

  if (!ok) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
