/**
 * Open insight editor tabs and screenshot.
 * npx tsx scripts/verify-insight-tabs-open.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import fs from "fs";
import path from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";
const OUT = path.join("tmp", "insight-tabs");

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
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // favicon 등 정적 404는 탭 렌더와 무관
    if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  await login(context, page, session, supabaseUrl);

  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=basic`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.getByRole("heading", { name: "화면에 나오는 것" }).waitFor({ timeout: 60_000 });

  const tabs: { id: string; marker: string }[] = [
    { id: "basic", marker: "화면에 나오는 것" },
    { id: "content", marker: "＋ 섹션 추가" },
    { id: "related", marker: "루나에게 추천받기" },
    { id: "history", marker: "이력" }
  ];

  for (const tab of tabs) {
    await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=${tab.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    if (tab.id === "basic") {
      await page.getByRole("heading", { name: "화면에 나오는 것" }).waitFor({ timeout: 30_000 });
    } else if (tab.id === "content") {
      await page.getByRole("button", { name: "＋ 섹션 추가" }).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "＋ 블록 추가" }).waitFor({ timeout: 30_000 });
    } else if (tab.id === "related") {
      await page.getByRole("button", { name: "루나에게 추천받기" }).waitFor({ timeout: 30_000 });
    } else {
      await page.getByText("공개할 때마다").or(page.getByText("지금 공개")).or(page.getByText("이력이 없습니다")).first().waitFor({ timeout: 30_000 });
    }
    await page.screenshot({ path: path.join(OUT, `${tab.id}.png`), fullPage: true });
    if (tab.id === "basic") {
      const groups = ["화면에 나오는 것", "대표 이미지", "검색과 AI 가 읽는 것"];
      for (const name of groups) {
        console.log(`basic group ${name}=${await page.getByRole("heading", { name, exact: true }).isVisible()}`);
      }
      console.log(
        `basic behind=${await page.getByRole("button", { name: "비하인드 워크" }).isVisible()}`
      );
      console.log(
        `basic crop=${await page.getByRole("button", { name: "비율·자르기" }).first().isVisible().catch(() => false)}`
      );
      console.log(
        `basic video=${await page.getByText("배경 영상").count()}`
      );
    }
    if (tab.id === "content") {
      const localeTabs = await page.getByRole("button", { name: /^국문$|^영문$/ }).count();
      console.log(`content localeTabs=${localeTabs} sectionAdd=${await page.getByRole("button", { name: "＋ 섹션 추가" }).isVisible()}`);
      await page.getByRole("button", { name: "＋ 블록 추가" }).click();
      const names = [
        "글",
        "질문 · 답변",
        "전폭",
        "2단",
        "3단",
        "자동",
        "가로 스크롤",
        "영상",
        "임베드"
      ];
      const found: string[] = [];
      for (const name of names) {
        if ((await page.getByText(name).count()) > 0) found.push(name);
      }
      console.log(`content picker=${found.join(",")}`);
      await page.screenshot({ path: path.join(OUT, "content-picker.png"), fullPage: true });
      await page.keyboard.press("Escape");
    }
    if (tab.id === "related") {
      console.log(
        `related recommend=${await page.getByRole("button", { name: "루나에게 추천받기" }).isVisible()}`
      );
      console.log(
        `related retryVisible=${await page.getByRole("button", { name: "다시 골라줘" }).isVisible().catch(() => false)}`
      );
      console.log(
        `related pickTop=${await page.locator(".rel-luna-row").getByText("직접 고르기").count()}`
      );
    }
    if (tab.id === "history") {
      console.log(
        `history version=${await page.getByText(/^v\d+/).first().isVisible().catch(() => false)} current=${await page.getByText("지금 공개 중").isVisible().catch(() => false)}`
      );
    }
    console.log(`ok tab=${tab.id}`);
  }

  const titleKo = errors.filter((e) => e.includes("TITLE_KO_MAX"));
  if (titleKo.length) throw new Error(titleKo.join("\n"));
  if (errors.length) {
    console.log("ERRORS", JSON.stringify(errors, null, 2));
    throw new Error(`console errors: ${errors.length}`);
  }
  console.log("VERIFY_OK", OUT);
  await browser.close();
}

main().catch((err) => {
  console.error("VERIFY_FAIL", err);
  process.exit(1);
});
