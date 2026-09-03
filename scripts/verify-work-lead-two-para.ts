import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const HUB = "http://localhost:3000";
const WORK = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SECRET_KEY!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin.from("profiles").select("email").eq("role", "슈퍼관리자").limit(1);
  const email = data![0]!.email as string;
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const anonC = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sess } = await anonC.auth.verifyOtp({
    token_hash: link!.properties!.hashed_token!,
    type: "email",
  });
  const session = sess!.session!;
  const ref = new URL(url).hostname.split(".")[0]!;
  const key = `sb-${ref}-auth-token`;
  const packed =
    "base64-" +
    Buffer.from(JSON.stringify(session))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: key, value: packed, url: HUB, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto(HUB, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
    [key, session] as const,
  );
  await page.goto(`${HUB}/website/works/${WORK}?tab=content`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.waitForSelector(".lead-drop");
  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead");

  const ed = page.locator(".rte-ed--work-lead").first();
  await ed.evaluate((el) => {
    el.innerHTML =
      "<p>첫 문단입니다. 첫 문단 내용입니다.</p><p>둘째 문단입니다. 둘째 문단 내용입니다.</p>";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.locator(".lead-btns .btn.acc").click();
  await page.waitForTimeout(400);

  const afterConfirm = await page.locator(".lead-drop .lead-html").first().evaluate((el) => ({
    html: el.innerHTML,
    p: el.querySelectorAll("p").length,
    lines: el.innerText.trim().split(/\n+/).filter(Boolean),
  }));

  await page.locator(".lead-drop").first().click();
  await page.waitForSelector(".rte-ed--work-lead");
  const afterReopen = await page.locator(".rte-ed--work-lead").first().evaluate((el) => {
    const ps = [...el.querySelectorAll("p")];
    return {
      html: el.innerHTML,
      p: ps.length,
      lines: el.innerText.trim().split(/\n+/).filter(Boolean),
      heights: ps.map((p) => Math.round(p.getBoundingClientRect().height)),
    };
  });

  writeFileSync(
    resolve("scripts/out-type-compare/work-lead-two-para.json"),
    JSON.stringify({ afterConfirm, afterReopen }, null, 2),
  );
  console.log(JSON.stringify({ afterConfirm, afterReopen }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
