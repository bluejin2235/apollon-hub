import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const HUB = "http://localhost:3000";
const WORK = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
const INSIGHT = "ed2cba6a-ade7-4f14-be32-980f0a813aef";

async function sessionFor(admin: ReturnType<typeof createClient>, anon: string, url: string, email: string) {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link!.properties!.hashed_token!,
    type: "email"
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: members } = await admin.from("profiles").select("email").eq("role", "멤버").limit(1);
  const email = members![0]!.email as string;
  const session = await sessionFor(admin, anon, url, email);
  const ref = new URL(url).hostname.split(".")[0]!;
  const key = `sb-${ref}-auth-token`;
  const packed =
    "base64-" +
    Buffer.from(JSON.stringify(session))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: key, value: packed, url: HUB, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(HUB, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );

  await page.goto(`${HUB}/website/works/${WORK}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(4500);
  const workBtns = await page.locator("button").evaluateAll((nodes) =>
    nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => /공개|저장|감춤|미리보기/.test(t))
  );

  await page.goto(`${HUB}/website/insights/${INSIGHT}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(4500);
  const insightBtns = await page.locator("button").evaluateAll((nodes) =>
    nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => /공개|저장|감춤|미리보기/.test(t))
  );

  await page.goto(`${HUB}/website/home`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);
  const homeText = await page.locator("body").innerText();
  const homeHasManage = /편성|추가|저장|슬롯|픽/.test(homeText);

  // 테스터가 설정으로 가면 /website 로 튕기는지
  const { data: testers } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "홈페이지테스터")
    .limit(1);
  let testerSettingsRedirect: string | null = null;
  if (testers?.[0]?.email) {
    const tSession = await sessionFor(admin, anon, url, testers[0].email as string);
    const tCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const tPacked =
      "base64-" +
      Buffer.from(JSON.stringify(tSession))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    await tCtx.addCookies([{ name: key, value: tPacked, url: HUB, sameSite: "Lax" }]);
    const tPage = await tCtx.newPage();
    await tPage.goto(HUB, { waitUntil: "domcontentloaded" });
    await tPage.evaluate(
      `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(tSession))})`
    );
    await tPage.goto(`${HUB}/settings`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await tPage.waitForTimeout(2000);
    testerSettingsRedirect = tPage.url();
    await tCtx.close();
  }

  console.log(
    JSON.stringify(
      {
        email,
        workBtns,
        insightBtns,
        workHasPublish: workBtns.some((t) => t.includes("공개")),
        insightHasPublish: insightBtns.some((t) => t.includes("공개")),
        homeHasManage,
        testerSettingsRedirect
      },
      null,
      2
    )
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
