/**
 * 지식 › 2차 데이터 · 자습 › 오늘 밤 장기 작업 화면 확인
 * npx tsx scripts/verify-luna-links.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const OUT = resolve(process.cwd(), "tmp", "luna-links-verify");

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

function check(name: string, ok: boolean, failed: { n: number }) {
  console.log(ok ? `✓ ${name}` : `✗ ${name}`);
  if (!ok) failed.n += 1;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: profiles } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .not("email", "is", null)
    .limit(3);
  const email = profiles?.find((r) => typeof r.email === "string")?.email;
  if (!email) throw new Error("슈퍼관리자 없음");

  const session = await createSession(admin, anonKey, supabaseUrl, email as string);
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  await login(context, page, session, supabaseUrl);
  const failed = { n: 0 };

  await page.goto(`${HUB_URL}/settings`, {
    waitUntil: "networkidle",
    timeout: 90_000
  });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "지식", exact: true }).click();
  await page.getByRole("button", { name: "2차 데이터", exact: true }).click();
  await page.getByRole("button", { name: /같은 것/ }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  const secondary = await page.locator("body").innerText();
  check("같은 것 칩에 건수", /같은 것\s*[1-9]/.test(secondary), failed);
  check("속한 것 칩에 건수", /속한 것\s*[1-9]/.test(secondary), failed);
  check("이어진 것 칩에 건수", /이어진 것\s*[1-9]/.test(secondary), failed);
  check("근거 한 줄", /이름 유사도|LLM 판정|블루진 확인|확인함/.test(secondary), failed);
  await page.screenshot({ path: resolve(OUT, "01-secondary.png"), fullPage: true });

  await page.getByRole("button", { name: /같은 것/ }).click();
  await page.waitForTimeout(2000);
  const sameText = await page.locator("body").innerText();
  check("확인 필요 칩", /확인 필요\s+\d+/.test(sameText), failed);
  check("확인함 칩", /확인함\s+\d+/.test(sameText), failed);
  check("아니라고 한 것 칩", /아니라고 한 것\s+\d+/.test(sameText), failed);
  check("아니에요 버튼", (await page.getByRole("button", { name: "✕ 아니에요" }).count()) > 0, failed);
  check("맞아요 버튼", (await page.getByRole("button", { name: "✓ 맞아요" }).count()) > 0, failed);

  const apiRes = await page.request.get(`${HUB_URL}/api/luna-admin/links?kind=same`);
  const payload = (await apiRes.json()) as {
    links: Array<{
      kind: string;
      source: string;
      status: string;
      confidence: number;
      evidence?: { similarity?: number };
    }>;
  };
  const need = payload.links.filter(
    (l) => l.kind === "same" && l.source !== "human" && l.status !== "rejected"
  );
  const simOf = (l: (typeof need)[0]) =>
    typeof l.evidence?.similarity === "number" ? l.evidence.similarity : 1;
  let orderOk = true;
  for (let i = 1; i < need.length; i += 1) {
    const prev = need[i - 1]!;
    const cur = need[i]!;
    if (prev.confidence < cur.confidence - 1e-6) continue;
    if (cur.confidence < prev.confidence - 1e-6) {
      orderOk = false;
      break;
    }
    if (simOf(prev) - simOf(cur) > 1e-6) {
      orderOk = false;
      break;
    }
  }
  check(
    `정렬 확신도 낮은 순 (${need.length}건 ${need[0]?.confidence}→${need.at(-1)?.confidence})`,
    orderOk && need.length > 1,
    failed
  );

  const pairCount = await page.locator(".luna-admin .pair").count();
  const firstTitle = (await page.locator(".luna-admin .pair .side .t").first().textContent()) ?? "";
  await page.locator(".luna-admin .pair").first().getByRole("button", { name: "✕ 아니에요" }).click();
  await page.waitForTimeout(1500);
  const afterCount = await page.locator(".luna-admin .pair").count();
  const afterReject = await page.locator("body").innerText();
  check("✕ 후 목록에서 사라짐", Boolean(firstTitle) && afterCount === pairCount - 1, failed);
  check("되돌리기 토스트", afterReject.includes("되돌리기"), failed);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await page.waitForTimeout(1500);
  const afterUndoCount = await page.locator(".luna-admin .pair").count();
  check("되돌리기 후 복구", afterUndoCount === pairCount, failed);
  await page.screenshot({ path: resolve(OUT, "01b-same-review.png"), fullPage: true });

  await page.getByRole("button", { name: /속한 것/ }).click();
  await page.waitForTimeout(1200);
  const belongs = await page.locator("body").innerText();
  check("속한 것 트리", /Work 파일|이미지|노션|├/.test(belongs), failed);
  await page.screenshot({ path: resolve(OUT, "02-belongs.png"), fullPage: true });

  await page.getByRole("button", { name: /관점/ }).click();
  await page.waitForTimeout(1200);
  const persp = await page.locator("body").innerText();
  check("관점 표", persp.includes("구조") || persp.includes("연출") || persp.includes("붙은 건수"), failed);
  await page.screenshot({ path: resolve(OUT, "03-perspectives.png"), fullPage: true });

  await page.getByRole("button", { name: "자습", exact: true }).click();
  await page.getByRole("button", { name: "오늘 밤", exact: true }).click();
  await page.waitForTimeout(2000);
  const progress = await page.locator("body").innerText();
  check(
    "오늘 밤 장기 작업",
    progress.includes("진행 중인 장기 작업") ||
      progress.includes("2차 데이터") ||
      progress.includes("오늘 밤은 건너뜁니다") ||
      progress.includes("오늘 밤"),
    failed
  );
  await page.screenshot({ path: resolve(OUT, "04-progress.png"), fullPage: true });

  await browser.close();
  if (failed.n > 0) {
    console.log(`FAILED ${failed.n}`);
    process.exit(1);
  }
  console.log("OK luna-links ui");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
