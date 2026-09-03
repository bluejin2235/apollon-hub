/**
 * 인사이트 signed GIF·MP4 + 워크 workId 호환 + 피커 9개
 * npx tsx scripts/verify-insight-signed-upload.ts
 */
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(
  readFileSync(resolve(process.cwd(), "../apollon-website/.env.local"), "utf8")
);

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = (process.env.WEBSITE_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const INSIGHT_ID = "4188f427-7224-4310-a640-26918b6f13ae";

function siteSecret() {
  return websiteEnv.ADMIN_API_SECRET!;
}

function makeGifBuffer(): Buffer {
  // 1x1 GIF
  return Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
}

function makeMp4Buffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.write("    ftypisom", 0, "ascii");
  buf[0] = 0;
  buf[1] = 0;
  buf[2] = 0;
  buf[3] = 20;
  return buf;
}

async function putSigned(signedUrl: string, body: Buffer, contentType: string) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-upsert": "false"
    },
    body
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function main() {
  const secret = siteSecret();
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json"
  };

  // 1) insight GIF signed
  const gifTicket = await fetch(`${SITE_URL}/api/admin/upload/signed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentType: "insight",
      contentId: INSIGHT_ID,
      kind: "gif",
      size: makeGifBuffer().length,
      folder: "insight-1788403880038/blocks"
    })
  });
  const gifJson = (await gifTicket.json()) as {
    data?: { signedUrl: string; path: string; bucket: string; publicUrl: string };
    error?: string;
  };
  if (!gifTicket.ok || !gifJson.data) {
    throw new Error(`insight gif ticket failed ${gifTicket.status} ${JSON.stringify(gifJson)}`);
  }
  const gifPut = await putSigned(gifJson.data.signedUrl, makeGifBuffer(), "image/gif");

  // 2) insight MP4 signed
  const mp4Buf = makeMp4Buffer(256 * 1024);
  const videoTicket = await fetch(`${SITE_URL}/api/admin/upload/signed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentType: "insight",
      contentId: INSIGHT_ID,
      kind: "video",
      size: mp4Buf.length
    })
  });
  const videoJson = (await videoTicket.json()) as {
    data?: { signedUrl: string; path: string; bucket: string; publicUrl: string };
    error?: string;
  };
  if (!videoTicket.ok || !videoJson.data) {
    throw new Error(`insight video ticket failed ${videoTicket.status} ${JSON.stringify(videoJson)}`);
  }
  const videoPut = await putSigned(videoJson.data.signedUrl, mp4Buf, "video/mp4");

  // 3) work legacy workId still works
  const worksRes = await fetch(`${SITE_URL}/api/admin/works?limit=1`, { headers });
  const worksBody = (await worksRes.json()) as { data?: { items?: { id: string; slug: string }[] } };
  const work = worksBody.data?.items?.[0];
  if (!work) throw new Error("no work for legacy check");
  const legacyTicket = await fetch(`${SITE_URL}/api/admin/upload/signed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workId: work.id,
      kind: "video",
      size: 1024
    })
  });
  const legacyJson = (await legacyTicket.json()) as {
    data?: { path: string; bucket: string };
    error?: string;
  };

  // 4) insight loop rejected
  const loopReject = await fetch(`${SITE_URL}/api/admin/upload/signed`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contentType: "insight",
      contentId: INSIGHT_ID,
      kind: "loop_lg",
      size: 1024
    })
  });
  const loopJson = (await loopReject.json()) as { error?: string };

  // 5) picker has 9 items (UI)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .limit(1)
    .maybeSingle();
  if (!profile?.email) throw new Error("no admin");
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: sessionData } = await anon.auth.verifyOtp({
    token_hash: link!.properties!.hashed_token!,
    type: "email"
  });
  const session = sessionData!.session!;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const ref = new URL(supabaseUrl).hostname.split(".")[0]!;
  const key = `sb-${ref}-auth-token`;
  const b64url = Buffer.from(JSON.stringify(session))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await context.addCookies([
    { name: key, value: `base64-${b64url}`, url: HUB_URL, sameSite: "Lax" }
  ]);
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [key, JSON.stringify(session)] as [string, string]
  );
  await page.goto(`${HUB_URL}/website/insights/${INSIGHT_ID}?tab=content`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.getByRole("button", { name: "＋ 블록 추가" }).click({ timeout: 60_000 });
  const pickerCount = await page.locator(".grid button").count();
  const pickerLabels = await page.locator(".grid button .text-sm.font-semibold").allTextContents();
  await browser.close();

  const report = {
    insightGif: {
      status: gifTicket.status,
      bucket: gifJson.data.bucket,
      path: gifJson.data.path,
      putStatus: gifPut.status,
      pathOk: gifJson.data.path.startsWith("insight-1788403880038/") && gifJson.data.path.includes("/blocks/")
    },
    insightVideo: {
      status: videoTicket.status,
      bucket: videoJson.data.bucket,
      path: videoJson.data.path,
      putStatus: videoPut.status,
      pathOk:
        videoJson.data.path.startsWith("insight-1788403880038/") &&
        videoJson.data.path.includes("/video/") &&
        videoJson.data.bucket === "insights"
    },
    workLegacy: {
      status: legacyTicket.status,
      bucket: legacyJson.data?.bucket ?? null,
      path: legacyJson.data?.path ?? null,
      ok: legacyTicket.status === 200 && legacyJson.data?.bucket === "works"
    },
    insightLoopRejected: {
      status: loopReject.status,
      error: loopJson.error ?? null,
      ok: loopReject.status === 400 && loopJson.error === "invalid_kind"
    },
    picker: {
      count: pickerCount,
      labels: pickerLabels,
      ok: pickerCount === 9
    }
  };

  console.log(JSON.stringify(report, null, 2));

  const ok =
    report.insightGif.putStatus >= 200 &&
    report.insightGif.putStatus < 300 &&
    report.insightGif.pathOk &&
    report.insightGif.bucket === "insights" &&
    report.insightVideo.putStatus >= 200 &&
    report.insightVideo.putStatus < 300 &&
    report.insightVideo.pathOk &&
    report.workLegacy.ok &&
    report.insightLoopRejected.ok &&
    report.picker.ok;

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
