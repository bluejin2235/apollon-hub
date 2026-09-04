/**
 * 「가기」가 대체텍스트 블록으로 스크롤되는지
 * npx tsx scripts/verify-insight-go-alt.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INSIGHT_ID = "ed2cba6a-ade7-4f14-be32-980f0a813aef";
const CONTENT_URL = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
const CONTENT_SERVICE = websiteEnv.SUPABASE_SECRET_KEY ?? websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
const HUB_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const HUB_SERVICE = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HUB_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
  return (data ?? [])[0]!.email as string;
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
  await context.addCookies([{ name: key, value: packed, url: HUB_URL, sameSite: "Lax" as const }]);
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))})`
  );
}

async function main() {
  const content = createClient(CONTENT_URL, CONTENT_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const hub = createClient(HUB_SB, HUB_SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: blocks } = await content
    .from("insight_blocks")
    .select("id")
    .eq("insight_id", INSIGHT_ID);
  const blockIds = (blocks ?? []).map((b) => b.id);
  const { data: images } = await content
    .from("insight_images")
    .select("id, block_id, alt")
    .in("block_id", blockIds);
  const img = images?.[0];
  if (!img) throw new Error("no image");
  const backups = new Map((images ?? []).map((i) => [i.id, i.alt]));
  for (const i of images ?? []) {
    await content
      .from("insight_images")
      .update({ alt: { ko: "임시", en: "t" } })
      .eq("id", i.id);
  }
  await content.from("insight_images").update({ alt: { ko: "", en: "" } }).eq("id", img.id);

  const session = await createSession(hub, HUB_ANON, HUB_SB, await pickAdminEmail(hub));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(context, page, session, HUB_SB);

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /점검/ }).first().click();
  await page.waitForTimeout(400);

  const row = page
    .locator("div.flex.items-start")
    .filter({ hasText: /본문\s*\d+번째\s*블록.*대체 텍스트가 없습니다/ })
    .first();
  await row.getByRole("button", { name: /^가기$/ }).click();
  await page.waitForTimeout(1200);

  const result = await page.evaluate((targetBlockId) => {
    const el = document.getElementById(`insight-block-${targetBlockId}`);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return {
      found: true,
      top: r.top,
      inView: r.top >= -80 && r.top < window.innerHeight * 0.85,
      tab: new URL(location.href).searchParams.get("tab"),
      open: el.querySelector("[aria-expanded='true'], .open") != null || el.getBoundingClientRect().height > 80
    };
  }, img.block_id);

  console.log(JSON.stringify({ targetBlockId: img.block_id, ...result }, null, 2));

  for (const i of images ?? []) {
    const bak = backups.get(i.id);
    await content
      .from("insight_images")
      .update({
        alt:
          bak && typeof bak === "object"
            ? bak
            : { ko: `alt ${i.id.slice(0, 6)}`, en: "alt" }
      })
      .eq("id", i.id);
  }

  await browser.close();
  if (!result.found || !result.inView) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
