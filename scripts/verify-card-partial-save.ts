/**
 * 썸네일 부분 저장 200 · 유지 · 실패 toast
 * npx tsx scripts/verify-card-partial-save.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=basic`;

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
  email: string,
): Promise<Session> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "no token");
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session as unknown as Session;
}

async function login(
  context: BrowserContext,
  page: Page,
  session: Session,
  supabaseUrl: string,
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
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, url: HUB_URL, sameSite: "Lax" as const })),
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`,
  );
}

async function adminPatch(body: Record<string, unknown>) {
  const base = (process.env.WEBSITE_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
  const secret = process.env.ADMIN_API_SECRET?.trim();
  if (!secret) throw new Error("no secret");
  const res = await fetch(`${base}/api/admin/works/${WORK_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(
    admin,
    anonKey,
    supabaseUrl,
    await pickAdminEmail(admin),
  );

  // prepare: clear card, ensure T-L candidate exists
  const prepared = await adminPatch({
    card_image: null,
    card_image_source: null,
    card_image_width: null,
    card_image_height: null,
  });
  const getBase = (process.env.WEBSITE_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
  const secret = process.env.ADMIN_API_SECRET!.trim();
  const current = (await (
    await fetch(`${getBase}/api/admin/works/${WORK_ID}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
  ).json()) as { data: { key_image: string; loop_lg_posters: string[] | null } };
  const poster = current.data.key_image;
  await adminPatch({ loop_lg_posters: [poster] });

  const badApi = await adminPatch({
    card_image: poster,
    card_image_source: "loop_lg:0",
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  const patches: Array<{ request: unknown; status: number; response: unknown }> = [];
  page.on("response", async (res) => {
    if (res.request().method() !== "PATCH") return;
    if (!res.url().includes(`/works/${WORK_ID}`)) return;
    let response: unknown = null;
    let request: unknown = null;
    try {
      request = res.request().postDataJSON();
    } catch {
      request = res.request().postData();
    }
    try {
      response = await res.json();
    } catch {
      response = await res.text();
    }
    patches.push({ request, status: res.status(), response });
  });

  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "공개하기" }).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const tlPick = page.locator("button.pk").filter({ hasText: "T-L 첫 장면" }).first();
  const keyPick = page.locator("button.pk").filter({ hasText: "대표 이미지" }).first();
  if ((await tlPick.count()) > 0) {
    await tlPick.click();
  } else {
    await keyPick.click();
  }
  await page.waitForTimeout(400);

  const mediaSave = page
    .locator("section.grp")
    .filter({ hasText: "이미지와 영상" })
    .getByRole("button", { name: "부분 저장" });
  await mediaSave.click();
  await page.waitForTimeout(2500);

  const savePatch = patches[patches.length - 1] ?? null;
  const saveOk = savePatch?.status === 200;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "공개하기" }).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const afterReload = await page.evaluate(async (workId) => {
    const res = await fetch(`/api/website/works/${workId}`, { credentials: "include" });
    const json = await res.json();
    const d = json.data ?? json;
    return {
      card: typeof d.card_image === "string" ? d.card_image : null,
      source: d.card_image_source ?? null,
    };
  }, WORK_ID);

  // failure toast: intercept next media PATCH
  await page.route(`**/api/website/works/${WORK_ID}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_card_image_source",
        details: {
          message: "card_image_source 는 key, loop_lg, loop_sm, upload 만 가능합니다",
          got: "loop_lg:0",
          allowed: ["key", "loop_lg", "loop_sm", "upload"],
        },
      }),
    });
  });

  if ((await keyPick.count()) > 0) await keyPick.click();
  else await tlPick.click();
  await page.waitForTimeout(300);
  await mediaSave.click();
  await page.waitForTimeout(1500);
  const toastText = await page.locator('[role="status"]').first().innerText().catch(() => null);
  await page.unroute(`**/api/website/works/${WORK_ID}`);

  const result = {
    preparedStatus: prepared.status,
    badApiStatus: badApi.status,
    badApiResponse: badApi.json,
    saveRequest: savePatch?.request ?? null,
    saveStatus: savePatch?.status ?? null,
    saveResponseError: (savePatch?.response as { error?: string })?.error ?? null,
    saveOk,
    afterReload,
    toastText,
  };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    badApi.status === 400 &&
    saveOk &&
    Boolean(afterReload.card) &&
    (afterReload.source === "loop_lg" || afterReload.source === "key") &&
    Boolean(toastText && toastText.includes("card_image_source"));

  await browser.close();
  if (!ok) {
    process.exitCode = 1;
    console.error("VERIFY_FAIL");
  } else {
    console.log("VERIFY_OK");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
