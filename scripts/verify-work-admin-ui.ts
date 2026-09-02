/**
 * 워크 어드민 — 태그·폴더·블록 펼침 Playwright 확인
 * npx tsx scripts/verify-work-admin-ui.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const BASIC_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=basic`;
const CONTENT_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=content`;

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
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .limit(1);
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

async function hubFetch(path: string, token: string) {
  const res = await fetch(`${HUB_URL}/api/website/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
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

  const tagsPayload = (await hubFetch("tags", session.access_token)) as {
    data?: { items?: Array<{ id: string; label?: { ko?: string } }> };
  };
  const allTags = tagsPayload.data?.items ?? [];
  const workPayload = (await hubFetch(`works/${WORK_ID}`, session.access_token)) as {
    data?: { work_tags?: Array<{ tag_id: string }> };
  };
  const onWork = new Set((workPayload.data?.work_tags ?? []).map((t) => t.tag_id));
  const sample = allTags.find((tag) => !onWork.has(tag.id));
  if (!sample) throw new Error("no tag available for add test");

  const sampleLabel = sample.label?.ko || sample.id;

  const consoleErrors: string[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await login(context, page, session, supabaseUrl);

  await page.goto(BASIC_URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  const internalFold = page.locator(".wa.fold").filter({ hasText: "내부 연결" }).first();
  await internalFold.locator("button.fh-toggle").click();
  await page.waitForTimeout(300);
  const folderLabelVisible = await page.getByText("사업개발 폴더", { exact: true }).isVisible();

  const tagFold = page.locator(".wa.fold").filter({ hasText: "태그" }).first();
  await tagFold.locator("button.fh-toggle").click();
  await page.waitForTimeout(300);

  const tagInput = page.getByPlaceholder("태그 입력 후 Enter");
  await tagInput.fill(sample.id.slice(0, 4));
  await page.waitForTimeout(600);
  const suggestion = page.locator("ul button").filter({ hasText: sample.id }).first();
  await suggestion.waitFor({ timeout: 10_000 });
  await suggestion.click();
  await page.waitForTimeout(2500);

  const chip = page.locator(".wa.chips .chip").filter({ hasText: sampleLabel }).first();
  let tagAdded = await chip.isVisible().catch(() => false);
  if (!tagAdded) {
    tagAdded = await page.locator(".wa.chips .chip").filter({ hasText: sample.id }).first().isVisible();
  }

  if (tagAdded) {
    await chip.locator("button.x").click();
    await page.waitForTimeout(1200);
  }
  const tagRemoved = tagAdded
    ? !(await chip.isVisible().catch(() => false))
    : false;

  await page.goto(CONTENT_URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1000);

  const blocksBefore = await page.locator(".blk.on").count();
  const addBlockBtn = page.getByRole("button", { name: "＋ 블록 추가" }).first();
  await addBlockBtn.click();
  await page.getByRole("heading", { name: "블록 추가", level: 2 }).waitFor({ timeout: 30_000 });
  await page.locator(".grid.grid-cols-2 button").first().click();
  await page.waitForTimeout(2000);

  const openBlocks = await page.locator(".blk.on").count();
  const blockExpanded = openBlocks > blocksBefore;

  await browser.close();

  const report = {
    consoleErrorCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 8),
    folderLabelVisible,
    tagAdded,
    tagRemoved,
    blockExpanded,
    blocksBefore,
    openBlocksAfterAdd: openBlocks,
  };

  console.log("\n=== work admin UI verify ===");
  console.log(JSON.stringify(report, null, 2));

  const failed =
    consoleErrors.length > 0 ||
    !folderLabelVisible ||
    !tagAdded ||
    !tagRemoved ||
    !blockExpanded;
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
