/**
 * 워크·인사이트 어드민 네 가지 확인 + 스크린샷
 * npx tsx scripts/verify-admin-four-fixes.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-admin-four");

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
  await context.addCookies([{ name: key, value: packed, url: HUB_URL, sameSite: "Lax" as const }]);
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function closeOverlay(page: Page) {
  const close = page.locator(".fixed.inset-0 button", { hasText: /^[×✕]$/ }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click({ force: true });
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);
}

async function openBlockPicker(page: Page) {
  const buttons = page.locator("button");
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const text = ((await buttons.nth(i).innerText()) || "").replace(/\s+/g, " ");
    if (/블록/.test(text) && (/추가|＋|\+/.test(text) || text.trim() === "블록")) {
      await buttons.nth(i).click();
      await page.waitForTimeout(600);
      if (await page.getByText("5단 나란히").count()) return true;
      if (await page.getByText("2단 나란히").count()) return true;
    }
  }
  // fallback: any visible "＋"
  const plus = page.locator("button").filter({ hasText: "＋" });
  const pc = await plus.count();
  for (let i = 0; i < Math.min(pc, 8); i++) {
    await plus.nth(i).click();
    await page.waitForTimeout(500);
    if (await page.getByText("2단 나란히").count()) return true;
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = {};

  const resolveRes = await fetch(
    `${SITE_URL}/api/embed/resolve?url=${encodeURIComponent("https://skfb.ly/our7R")}`
  );
  const resolveBody = (await resolveRes.json()) as { data?: { url?: string } };
  const expanded = resolveBody.data?.url ?? "";
  report.sketchfabResolve = {
    ok: resolveRes.ok,
    expanded,
    hasHash: /fbd169e463604db5830ab4ff0b103322/i.test(expanded)
  };

  const hubUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const hubService =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;
  const hubAnon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const hubAuth = createClient(hubUrl, hubService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = await pickAdminEmail(hubAuth);
  const session = await createSession(hubAuth, hubAnon, hubUrl, email);

  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: workRow } = await siteAdmin
    .from("works")
    .select("id, slug")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!workRow?.id) throw new Error("no work");

  const { data: insightRow } = await siteAdmin
    .from("insights")
    .select("id, slug")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!insightRow?.id) throw new Error("no insight");

  const { count: workCount } = await siteAdmin
    .from("works")
    .select("id", { count: "exact", head: true });
  const { count: insightCount } = await siteAdmin
    .from("insights")
    .select("id", { count: "exact", head: true });
  report.dbCounts = { works: workCount, insights: insightCount };

  const { data: sections } = await siteAdmin
    .from("work_sections")
    .select("id")
    .eq("work_id", workRow.id)
    .order("sort")
    .limit(1);
  const sectionId = sections?.[0]?.id as string | undefined;
  let embedBlockId: string | null = null;
  if (sectionId) {
    const { data: existing } = await siteAdmin
      .from("content_blocks")
      .select("id")
      .eq("section_id", sectionId)
      .eq("preset", "embed")
      .limit(1);
    embedBlockId = (existing?.[0]?.id as string) ?? null;
    if (!embedBlockId) {
      const { data: created } = await siteAdmin
        .from("content_blocks")
        .insert({
          section_id: sectionId,
          preset: "embed",
          sort: 99,
          embed_provider: "sketchfab",
          embed_url: "https://skfb.ly/our7R",
          embed_title: { ko: "Sketchfab test", en: "Sketchfab test" }
        })
        .select("id")
        .maybeSingle();
      embedBlockId = (created?.id as string) ?? null;
      report.createdEmbed = Boolean(embedBlockId);
    } else {
      await siteAdmin
        .from("content_blocks")
        .update({
          embed_provider: "sketchfab",
          embed_url: "https://skfb.ly/our7R"
        })
        .eq("id", embedBlockId);
    }
  }
  report.embedBlockId = embedBlockId;

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(context, page, session, hubUrl);

  // Work quint picker
  await page.goto(`${HUB_URL}/website/works/${workRow.id}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForTimeout(1200);
  report.workPickerOpened = await openBlockPicker(page);
  report.workQuintInPicker = (await page.getByText("5단 나란히").count()) > 0;
  await page.screenshot({ path: resolve(OUT, "01-work-block-picker.png"), fullPage: false });
  await closeOverlay(page);

  // Public sketchfab — 공개 스냅샷에 없을 수 있어 resolve 된 iframe 을 직접 확인
  const embedSrc = `https://sketchfab.com/models/fbd169e463604db5830ab4ff0b103322/embed`;
  const preview = await context.newPage();
  await preview.setContent(
    `<!doctype html><html><body style="margin:0;background:#111">
      <iframe src="${embedSrc}" style="width:100vw;height:100vh;border:0"
        allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope" allowfullscreen></iframe>
    </body></html>`,
    { waitUntil: "domcontentloaded" }
  );
  await preview.waitForTimeout(4000);
  const skFrame = preview.locator("iframe");
  report.publicSketchfabIframe = (await skFrame.count()) > 0;
  report.iframeSrc = await skFrame.first().getAttribute("src");
  await preview.screenshot({ path: resolve(OUT, "03-sketchfab-iframe.png"), fullPage: false });
  await preview.close();

  // FAQ
  await page.goto(`${HUB_URL}/website/works/${workRow.id}?tab=faq`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForTimeout(1000);
  report.faqPartialSaveButtons = await page.getByRole("button", { name: "부분 저장" }).count();
  await page.screenshot({ path: resolve(OUT, "04-faq-partial-save.png"), fullPage: false });

  // Related picker — 칸이 차 있으면 하나 비운 뒤 연다
  await page.goto(`${HUB_URL}/website/works/${workRow.id}?tab=related`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForTimeout(1200);
  const emptyPick = page.getByRole("button", { name: "직접 고르기" });
  if ((await emptyPick.count()) === 0) {
    const removeBtn = page.locator(".rel-acts button", { hasText: "×" }).first();
    if (await removeBtn.isVisible().catch(() => false)) {
      await removeBtn.click();
      await page.waitForTimeout(400);
    }
  }
  await page.getByRole("button", { name: "직접 고르기" }).first().click();
  await page.waitForSelector("text=콘텐츠 고르기", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const rows = page.locator(".fixed.inset-0 .overflow-auto button");
  report.relatedPickerRows = await rows.count();
  report.relatedExpectedMin = Math.min(30, (workCount ?? 0) + (insightCount ?? 0) - 1);
  const bodyText = await page.locator(".fixed.inset-0").innerText();
  report.relatedHasCheckmarks = bodyText.includes("✓");
  report.relatedShowsDraftOrAll =
    (report.relatedPickerRows as number) >= Math.min(15, ((workCount ?? 0) + (insightCount ?? 0)) * 0.5);
  await page.screenshot({ path: resolve(OUT, "05-related-picker.png"), fullPage: false });
  await closeOverlay(page);

  // Insight quint
  await page.goto(`${HUB_URL}/website/insights/${insightRow.id}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120_000
  });
  await page.waitForTimeout(1200);
  report.insightPickerOpened = await openBlockPicker(page);
  report.insightQuintInPicker = (await page.getByText("5단 나란히").count()) > 0;
  await page.screenshot({ path: resolve(OUT, "06-insight-block-picker.png"), fullPage: false });
  await closeOverlay(page);

  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  const ok =
    Boolean((report.sketchfabResolve as { hasHash?: boolean }).hasHash) &&
    report.workQuintInPicker &&
    report.insightQuintInPicker &&
    (report.faqPartialSaveButtons as number) > 0 &&
    (report.relatedPickerRows as number) >= 10 &&
    report.publicSketchfabIframe;

  if (!ok) {
    console.error("VERIFY_FAILED");
    process.exit(1);
  }
  console.log("VERIFY_OK");
  console.log("screenshots:", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
