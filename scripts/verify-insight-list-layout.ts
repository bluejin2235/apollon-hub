/**
 * Insight list layout smoke + screenshots.
 * npx tsx scripts/verify-insight-list-layout.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import fs from "fs";
import path from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.join("tmp", "insight-list-layout");

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/insights`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "인사이트" }).waitFor({ timeout: 60_000 });
  await page.locator("table tbody tr").first().waitFor({ timeout: 60_000 });

  const metrics = await page.locator("table tbody tr").evaluateAll((trs) =>
    trs.slice(0, 10).map((tr) => {
      const rect = tr.getBoundingClientRect();
      const img = tr.querySelector("td a img, td a span.grid") as HTMLElement | null;
      const title = tr.querySelector("td a span.min-w-0 > span") as HTMLElement | null;
      const imgRect = img?.getBoundingClientRect();
      const titleRect = title?.getBoundingClientRect();
      const titleText = title?.textContent ?? "";
      return {
        rowH: Math.round(rect.height),
        imgW: imgRect ? Math.round(imgRect.width) : 0,
        imgH: imgRect ? Math.round(imgRect.height) : 0,
        titleW: titleRect ? Math.round(titleRect.width) : 0,
        titleH: titleRect ? Math.round(titleRect.height) : 0,
        titleSample: titleText.slice(0, 48),
        titleLooksVertical: Boolean(titleRect && titleRect.width < 28 && titleText.trim().length > 4)
      };
    })
  );

  const badHeight = metrics.filter((m) => m.rowH > 100);
  const widths = [...new Set(metrics.map((m) => m.imgW).filter((w) => w > 0))];
  const vertical = metrics.filter((m) => m.titleLooksVertical);
  const heights = [...new Set(metrics.map((m) => m.imgH).filter((h) => h > 0))];

  await page.screenshot({ path: path.join(OUT, "insights-list.png"), fullPage: false });
  await page.goto(`${HUB_URL}/website/works`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "워크" }).waitFor({ timeout: 60_000 }).catch(() => null);
  await page.screenshot({ path: path.join(OUT, "works-list.png"), fullPage: false });

  console.log(JSON.stringify({ metrics, widths, heights, badHeight: badHeight.length, vertical: vertical.length }, null, 2));

  if (badHeight.length) throw new Error(`rows taller than 100px: ${JSON.stringify(badHeight)}`);
  if (vertical.length) throw new Error(`title vertical: ${JSON.stringify(vertical)}`);
  if (widths.length !== 1 || widths[0] !== 56) {
    throw new Error(`thumb widths expected single 56, got ${widths.join(",")}`);
  }
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 5).join(" | ")}`);

  console.log("VERIFY_OK", path.join(OUT, "insights-list.png"));
  await browser.close();
}

main().catch((err) => {
  console.error("VERIFY_FAIL", err);
  process.exit(1);
});
