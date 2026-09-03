/**
 * FAQ blur 자동 저장 · 헤더 AutoSaveLabel
 * npx tsx scripts/verify-faq-autosave.ts
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
const WORK_URL = `${HUB_URL}/website/works/${WORK_ID}?tab=faq`;

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const siteUrl = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const siteService = websiteEnv.SUPABASE_SERVICE_ROLE_KEY ?? websiteEnv.SUPABASE_SECRET_KEY!;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const siteAdmin = createClient(siteUrl, siteService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const token = session.access_token;

  const { data: faqsBefore } = await siteAdmin
    .from("faqs")
    .select("id, question, answer, sort")
    .eq("work_id", WORK_ID)
    .order("sort");
  let faq = (faqsBefore ?? [])[0] as
    | { id: string; question: { ko?: string; en?: string }; answer: { ko?: string; en?: string } }
    | undefined;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);

  await page.goto(WORK_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);

  const autoSaveLabel = await page.locator(".grph").filter({ hasText: "FAQ" }).getByText("자동 저장됨").isVisible();
  const partialSaveInHeader = await page
    .locator(".grph")
    .filter({ hasText: "FAQ" })
    .getByRole("button", { name: "부분 저장" })
    .count();

  if (!faq) {
    const createRes = await fetch(`${HUB_URL}/api/website/faqs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "work",
        work_id: WORK_ID,
        question: { ko: "임시 질문?", en: "" },
        answer: { ko: "임시 답변입니다.", en: "" },
        sort: 0,
        in_schema: true,
      }),
    });
    const createJson = (await createRes.json()) as { data?: { id: string; question: { ko?: string } } };
    if (!createRes.ok || !createJson.data?.id) {
      throw new Error(`faq create failed ${createRes.status}`);
    }
    faq = createJson.data as typeof faq;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("button", { name: "전체 저장", exact: true }).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1000);
  }
  if (!faq) throw new Error("no faq row");

  const originalQ = faq.question;
  const testQ = `검증 FAQ ${Date.now()}?`.slice(0, 45);

  // 접혀 있으면 펼침
  const firstCard = page.locator("div.overflow-hidden.rounded-xl.border").first();
  await firstCard.waitFor({ state: "visible", timeout: 30_000 });
  if ((await firstCard.getByText("국문 15~45자").count()) === 0) {
    await firstCard.locator("button").first().click();
    await page.waitForTimeout(400);
  }

  const langKo = firstCard.locator("input").first();
  await langKo.waitFor({ state: "visible", timeout: 15_000 });
  await langKo.fill(testQ);
  await langKo.blur();
  await page.waitForTimeout(2500);

  const { data: afterSave } = await siteAdmin
    .from("faqs")
    .select("question")
    .eq("id", faq.id)
    .maybeSingle();
  const savedKo = (afterSave?.question as { ko?: string } | null)?.ko ?? null;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "전체 저장", exact: true }).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1000);
  const remainsAfterReload = await page.getByText(testQ, { exact: false }).isVisible();

  await siteAdmin.from("faqs").update({ question: originalQ }).eq("id", faq.id);

  await browser.close();

  const report = {
    autoSaveLabel,
    partialSaveInHeader,
    savedKo,
    remainsAfterReload,
    faqId: faq.id,
  };
  console.log("\n=== faq autosave verify ===");
  console.log(JSON.stringify(report, null, 2));

  const ok =
    autoSaveLabel &&
    partialSaveInHeader === 0 &&
    savedKo === testQ &&
    remainsAfterReload;
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
