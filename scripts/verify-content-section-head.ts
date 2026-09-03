/**
 * 본문 탭 섹션 머리 — 확인 · 부분 저장 · 글자 수
 * npx tsx scripts/verify-content-section-head.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const WORK_ID = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=content`;

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL;
  const siteService =
    websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY;
  if (!siteUrl || !siteService) throw new Error("website supabase missing");
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const { data: sections, error: secErr } = await siteAdmin
    .from("work_sections")
    .select("id, lead, sort, kind")
    .eq("work_id", WORK_ID)
    .order("sort");
  if (secErr) throw new Error(secErr.message);
  const first = (sections ?? []).find((row) => row.kind !== "interview");
  if (!first) throw new Error("no content section");
  const originalLead = first.lead;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const report: string[] = [];
  const log = (label: string, value: string) => {
    const line = `${label}: ${value.slice(0, 800)}`;
    report.push(line);
    console.log(line);
  };

  try {
    await login(context, page, session, supabaseUrl);
    await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 60_000 });

    const sec = page.locator(".sec.on").first();
    const leadFld = sec.locator(".fld").filter({ hasText: "기본 설명" });
    await leadFld.locator("button.q").click();
    const tipText = await leadFld.locator(".tip.on").innerText();
    log("tip panel", tipText);
    if (!tipText.includes("300") || !tipText.includes("600")) {
      throw new Error("tip missing 300/600");
    }
    if (/\b60\b/.test(tipText) || /\b120\b/.test(tipText)) {
      throw new Error(`tip has old limits: ${tipText}`);
    }
    const leadAreaText = await leadFld.innerText();
    if (/\b60\b/.test(leadAreaText) || /\b120\b/.test(leadAreaText)) {
      throw new Error(`lead area has old limits: ${leadAreaText.slice(0, 200)}`);
    }

    const countText = await leadFld.locator(".cn").innerText();
    log("5 count before", countText);
    if (!countText.includes("/ 300")) throw new Error("limit not 300");

    const drop = sec.locator(".lead-drop").first();
    await drop.click();
    await page.locator(".lead-ov").waitFor({ state: "visible", timeout: 10_000 });

    const editor = page.locator(".rte-ed").first();
    await editor.click();
    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");
    await page.getByTitle("굵게").click();
    log("1 editor after bold", await editor.innerHTML());

    await page.getByRole("button", { name: "확인" }).click();
    await page.locator(".lead-ov").waitFor({ state: "hidden", timeout: 10_000 });

    await sec.getByText("저장할 것이 있습니다").waitFor({ state: "visible", timeout: 5_000 });
    log("2 dirty label", "저장할 것이 있습니다");

    const dropHtml = sec.locator(".lead-html").first();
    log("4 drop after confirm", await dropHtml.innerHTML());
    if ((await dropHtml.locator("b, strong").count()) === 0) {
      throw new Error("drop lost bold after confirm");
    }

    await sec.locator(".mb-3").getByRole("button", { name: "부분 저장" }).click();
    await sec.getByText("저장되었습니다").waitFor({ state: "visible", timeout: 20_000 });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator(".sec.on .lead-html").first().waitFor({ state: "visible", timeout: 30_000 });
    const afterReload = page.locator(".sec.on .lead-html").first();
    log("6 drop after reload", await afterReload.innerHTML());
    if ((await afterReload.locator("b, strong").count()) === 0) {
      throw new Error("reload lost bold");
    }

    const countAfter = await page
      .locator(".sec.on")
      .first()
      .locator(".fld")
      .filter({ hasText: "기본 설명" })
      .locator(".cn")
      .innerText();
    log("5 count after reload", countAfter);
    if (!countAfter.includes("274") || !countAfter.includes("/ 300")) {
      throw new Error(`expected 274 / 300, got: ${countAfter}`);
    }

    const { data: saved, error: savedErr } = await siteAdmin
      .from("work_sections")
      .select("lead")
      .eq("id", first.id)
      .maybeSingle();
    if (savedErr) throw new Error(savedErr.message);
    log("7 DB lead.ko", JSON.stringify((saved?.lead as { ko?: string })?.ko ?? ""));

    const hubFiltered = consoleErrors.filter(
      (line) => !line.includes("Download the React DevTools")
    );
    if (hubFiltered.length > 0) throw new Error(`hub console: ${hubFiltered.join(" | ")}`);

    console.log(report.join("\n"));
    console.log("OK");
  } finally {
    const { error: restoreErr } = await siteAdmin
      .from("work_sections")
      .update({ lead: originalLead })
      .eq("id", first.id);
    if (restoreErr) console.error("restore failed", restoreErr.message);
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
