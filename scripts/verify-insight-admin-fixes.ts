/**
 * 인사이트 어드민 수정 확인
 * npx tsx scripts/verify-insight-admin-fixes.ts
 */
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type ConsoleMessage, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";
const OUT = path.join("tmp", "insight-admin-fixes");
const EXPECTED_PRESETS = [
  "text",
  "qa",
  "full",
  "split",
  "triple",
  "gallery-auto",
  "stack",
  "carousel",
  "video-full",
  "embed"
];

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
  if (linkErr || !link.properties?.hashed_token) {
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

function filterErrors(errors: string[]) {
  return errors.filter((line) => !/favicon|Download the React DevTools/i.test(line));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
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
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await login(context, page, session, supabaseUrl);

  const report: string[] = [];

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.getByRole("heading", { name: "화면에 나오는 것" }).waitFor({ timeout: 60_000 });
  const visLabel = ((await page.locator("span").filter({ hasText: /^(공개|초안|감춤)$/ }).first().textContent()) ?? "").trim();
  const published = visLabel === "공개" || visLabel === "감춤";
  report.push(`visibility=${visLabel} treatPublished=${published}`);

  const dateInput = page.locator('input[type="date"]').first();
  const dateType = await dateInput.getAttribute("type");
  report.push(`date input type=${dateType}`);
  await dateInput.click();
  await page.screenshot({ path: path.join(OUT, "01-date.png"), fullPage: true });

  const slugBefore = await page.locator(".slugrow input.i").inputValue();
  const remake = page.getByRole("button", { name: "다시 만들기" });
  const remakeVisible = await remake.isVisible().catch(() => false);
  report.push(`remake visible=${remakeVisible} published=${published}`);

  const titleKo = page.locator(".seclang").filter({ hasText: "국문" }).locator("input.i").first();
  const originalTitle = await titleKo.inputValue();
  await titleKo.fill(`${originalTitle} 확인`);
  await page.waitForTimeout(1200);
  const slugAfterTitle = await page.locator(".slugrow input.i").inputValue();
  if (published) {
    report.push(`slug auto after title=${slugAfterTitle === slugBefore ? "unchanged" : "CHANGED"}`);
  } else {
    report.push(`slug after title=${slugAfterTitle}`);
  }
  await titleKo.fill(originalTitle);

  if (remakeVisible && !published) {
    await remake.click();
    await page.waitForTimeout(4000);
    const slugAfterRemake = await page.locator(".slugrow input.i").inputValue();
    report.push(`slug after remake=${slugAfterRemake}`);
  }

  await page.screenshot({ path: path.join(OUT, "02-slug.png"), fullPage: true });

  const cropBtn = page.getByRole("button", { name: "비율·자르기" }).first();
  let cropSaved = false;
  if (await cropBtn.isVisible().catch(() => false)) {
    await cropBtn.click();
    await page.getByText("비율 고르고 자르기").waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.join(OUT, "03-crop.png") });
    const save = page.getByRole("dialog").getByRole("button", { name: "저장", exact: true });
    const enabled = await save.isEnabled({ timeout: 20_000 }).catch(() => false);
    report.push(`crop save enabled=${enabled}`);
    if (enabled) {
      await save.click();
      const hidden = await page
        .getByText("비율 고르고 자르기")
        .waitFor({ state: "hidden", timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      const toast = await page.locator(".toast, [class*='toast']").allTextContents().catch(() => []);
      cropSaved = hidden;
      report.push(`crop saved=${hidden} toast=${JSON.stringify(toast).slice(0, 200)}`);
    } else {
      await page.getByRole("button", { name: "취소" }).click();
    }
  } else {
    report.push("crop button=false");
  }
  await page.screenshot({ path: path.join(OUT, "04-basic-after-crop.png"), fullPage: true });

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.getByRole("button", { name: "＋ 블록 추가" }).waitFor({ timeout: 30_000 });
  const sectionHead = await page.getByText("섹션 색", { exact: false }).count();
  const collapse = await page.getByRole("button", { name: "전체 접기" }).count();
  const addSection = await page.getByRole("button", { name: "＋ 섹션 추가" }).count();
  const addBlock = await page.getByRole("button", { name: "＋ 블록 추가" }).count();
  report.push(`section chrome 색=${sectionHead} 접기=${collapse} 섹션추가=${addSection} 블록추가=${addBlock}`);
  await page.screenshot({ path: path.join(OUT, "05-content.png"), fullPage: true });

  await page.getByRole("button", { name: "＋ 블록 추가" }).click();
  await page.getByRole("heading", { name: "블록 추가" }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const presets = await page.locator("[data-insight-preset]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-insight-preset") ?? "")
  );
  report.push(`picker count=${presets.length} items=${presets.join(",")}`);
  const missing = EXPECTED_PRESETS.filter((id) => !presets.includes(id));
  report.push(`picker missing=${missing.join(",") || "none"}`);
  await page.screenshot({ path: path.join(OUT, "06-picker.png") });
  await page.getByRole("button", { name: "닫기" }).click();

  const filtered = filterErrors(errors);
  report.push(`console errors=${filtered.length}${filtered.length ? ` ${filtered.join(" | ")}` : ""}`);
  fs.writeFileSync(path.join(OUT, "report.txt"), report.join("\n"));
  console.log(report.join("\n"));

  if (
    dateType !== "date" ||
    addSection > 0 ||
    collapse > 0 ||
    addBlock < 1 ||
    presets.length !== 10 ||
    missing.length > 0 ||
    filtered.length > 0 ||
    (published && slugAfterTitle !== slugBefore)
  ) {
    throw new Error("VERIFY_FAIL\n" + report.join("\n"));
  }
  if (!cropSaved) {
    report.push("crop save not confirmed — check screenshot");
  }
  console.log("VERIFY_OK");
  console.log(`screenshots ${OUT}`);
  await browser.close();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
