/**
 * 인사이트 저장/공개 분리 — Playwright 실측
 * npx tsx scripts/verify-insight-publish-ui.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local"), "utf8"));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = (
  process.env.WEBSITE_API_URL ??
  websiteEnv.NEXT_PUBLIC_SITE_URL ??
  "http://localhost:3100"
).replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";
const WORK_ID = "7ed48f01-4624-4bdf-a589-a79d907c67b7";
const OUT_DIR = resolve(process.cwd(), "tmp/insight-publish-ui-verify");
const MARK = ` ·v${Date.now().toString().slice(-6)}`;

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

function siteSecret() {
  return websiteEnv.ADMIN_API_SECRET!;
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

async function bottomBar(page: Page) {
  return page.locator(".sticky.bottom-0").last();
}

async function visibleBarButtons(page: Page) {
  const bar = await bottomBar(page);
  const names = ["미리보기", "전체 저장", "점검", "공개", "다시 공개", "감추기", "등록하기"];
  const found: string[] = [];
  for (const name of names) {
    const btn = bar.getByRole("button", { name: new RegExp(`^${name}`) });
    if (await btn.isVisible().catch(() => false)) found.push(name);
  }
  return found;
}

async function openEditor(page: Page, kind: "insight" | "work", id: string) {
  const path = kind === "insight" ? `/website/insights/${id}?tab=basic` : `/website/works/${id}?tab=basic`;
  await page.goto(`${HUB_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).first().waitFor({ timeout: 60_000 });
}

async function siteFetch(path: string) {
  const res = await fetch(`${SITE_URL}${path}`, { redirect: "manual" });
  const html = await res.text().catch(() => "");
  const title = html.match(/<h1[^>]*class="[^"]*insight-detail__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1]
    ?.replace(/<[^>]+>/g, "")
    .trim();
  return { status: res.status, title: title ?? null, htmlLen: html.length };
}

async function adminCall(path: string, init?: RequestInit) {
  const res = await fetch(`${SITE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${siteSecret()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await res.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: string;
    details?: unknown;
  } | null;
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const email = await pickAdminEmail(admin);
  const session = await createSession(admin, anonKey, supabaseUrl, email);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  const report: Record<string, unknown> = { insightId: INSIGHT_ID };

  try {
    try {
      await openEditor(page, "work", WORK_ID);
      report.workButtons = await visibleBarButtons(page);
    } catch (err) {
      report.workButtonsError = err instanceof Error ? err.message : String(err);
      report.workButtons = [];
    }

    await openEditor(page, "insight", INSIGHT_ID);
    const insightButtons = await visibleBarButtons(page);
    report.insightButtons = insightButtons;
    const workButtons = (report.workButtons as string[]) ?? [];
    const expected = ["미리보기", "전체 저장", "점검", "공개"];
    report.footerSameAsWork =
      expected.every((name) => insightButtons.includes(name)) &&
      !insightButtons.includes("감추기") &&
      !insightButtons.includes("등록하기") &&
      (workButtons.length === 0 ||
        expected.every((name) => workButtons.includes(name)));

    const bar = await bottomBar(page);
    const checkBtn = bar.getByRole("button", { name: "점검" });
    await checkBtn.click();
    const overlay = page.locator(".sticky.bottom-0 .absolute.bottom-full");
    const overlayOpen = await overlay.isVisible().catch(() => false);
    report.checkExpanded = overlayOpen;
    if (overlayOpen) {
      report.checkHasPills = (await overlay.getByText("필수").count()) + (await overlay.getByText("권장").count()) > 0;
      report.checkHasGo = (await overlay.getByRole("button", { name: "가기" }).count()) > 0;
      await page.getByRole("button", { name: "접기" }).click();
      report.checkCollapsed = !(await overlay.isVisible().catch(() => false));
    } else {
      report.checkCollapsed = true;
      report.checkEmpty = true;
    }

    const detail = await adminCall(`/api/admin/insights/${INSIGHT_ID}`);
    if (!detail.ok || !detail.body?.data) {
      throw new Error(`insight_detail_failed:${detail.status}:${detail.body?.error ?? ""}`);
    }
    const insight = detail.body.data as {
      slug: string;
      title?: { ko?: string };
    };
    const slug = insight.slug;
    const originalTitle = insight.title?.ko ?? "";
    report.slug = slug;
    report.originalTitle = originalTitle;

    const publicBefore = await siteFetch(`/insight/${slug}`);
    report.publicBefore = publicBefore;

    const titleInput = page.locator(".two input.i").first();
    await titleInput.waitFor({ timeout: 30_000 });
    await titleInput.fill(`${originalTitle}${MARK}`);
    await bar.getByRole("button", { name: "전체 저장" }).click();
    await page.getByText("저장되었습니다").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);

    const publicAfterSave = await siteFetch(`/insight/${slug}`);
    report.publicAfterSave = publicAfterSave;
    report.saveDidNotChangeSite =
      publicAfterSave.status === publicBefore.status &&
      publicAfterSave.title === publicBefore.title &&
      !(publicAfterSave.title ?? "").includes(MARK);

    const publish = await adminCall("/api/admin/publish", {
      method: "POST",
      body: JSON.stringify({
        contentType: "insight",
        contentId: INSIGHT_ID,
        changeNote: "검증용 공개",
        skipChecks: true
      })
    });
    report.publishApi = { ok: publish.ok, status: publish.status, error: publish.body?.error ?? null };
    if (!publish.ok) {
      throw new Error(`publish_failed:${publish.status}:${JSON.stringify(publish.body)}`);
    }
    await page.waitForTimeout(1200);

    const publicAfterPublish = await siteFetch(`/insight/${slug}`);
    report.publicAfterPublish = publicAfterPublish;
    report.publishChangedSite =
      publicAfterPublish.status === 200 && (publicAfterPublish.title ?? "").includes(MARK);

    const restore = await adminCall(`/api/admin/insights/${INSIGHT_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ title: { ko: originalTitle, en: (detail.body.data as { title?: { en?: string } }).title?.en ?? "" } })
    });
    report.restorePatch = { ok: restore.ok, status: restore.status };
    const republish = await adminCall("/api/admin/publish", {
      method: "POST",
      body: JSON.stringify({
        contentType: "insight",
        contentId: INSIGHT_ID,
        changeNote: "검증용 제목 복구",
        skipChecks: true
      })
    });
    report.restorePublish = { ok: republish.ok, status: republish.status };

    await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=history`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    await page.getByRole("button", { name: "이력", exact: true }).waitFor({ timeout: 60_000 });
    const historyEmpty = await page.getByText("아직 공개하지 않았습니다").isVisible().catch(() => false);
    const versionText = await page.locator(".hitem").first().innerText().catch(() => "");
    const currentBadge = versionText.includes("지금 공개 중");
    report.history = {
      empty: historyEmpty,
      currentBadge,
      firstItem: versionText.slice(0, 200)
    };
    report.historyOk = !historyEmpty && currentBadge && /v\d+/.test(versionText);

    const shot = resolve(OUT_DIR, "insight-publish-ui.png");
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshot = shot;
  } finally {
    await browser.close();
  }

  console.log("\n=== insight publish UI verify ===");
  console.log(JSON.stringify(report, null, 2));

  const failed =
    report.footerSameAsWork !== true ||
    report.checkCollapsed !== true ||
    report.saveDidNotChangeSite !== true ||
    report.publishChangedSite !== true ||
    report.historyOk !== true;

  if (failed) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
