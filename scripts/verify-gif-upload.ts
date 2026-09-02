/**
 * GIF 는 1600 검사 제외 · JPG 는 거부
 * npx tsx scripts/verify-gif-upload.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

import sharp from "sharp";

const SITE_URL = (process.env.WEBSITE_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");

function adminHeaders() {
  const secret = process.env.ADMIN_API_SECRET?.trim() || process.env.WEBSITE_ADMIN_SECRET?.trim();
  if (!secret) throw new Error("no admin secret");
  return { Authorization: `Bearer ${secret}` };
}

async function makeJpeg800() {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 80, b: 120 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function makeGif800() {
  return sharp({
    create: { width: 800, height: 600, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } },
  })
    .gif()
    .toBuffer();
}

async function upload(buffer: Buffer, name: string, mime: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], name, { type: mime }));
  form.append("bucket", "works");
  form.append("path", `verify/gif-test/${Date.now()}/${name}`);
  form.append("role", "body");
  const res = await fetch(`${SITE_URL}/api/admin/upload`, {
    method: "POST",
    headers: adminHeaders(),
    body: form,
  });
  const json = (await res.json()) as {
    error?: string;
    details?: { message?: string };
    data?: { path: string; width: number; height: number; size: number; mime: string };
  };
  return { status: res.status, json };
}

async function main() {
  const jpg = await makeJpeg800();
  const gif = await makeGif800();

  const jpgRes = await upload(jpg, "small-800.jpg", "image/jpeg");
  const gifRes = await upload(gif, "small-800.gif", "image/gif");

  const report = {
    jpg: {
      status: jpgRes.status,
      error: jpgRes.json.error ?? null,
      message: jpgRes.json.details?.message ?? null,
      ok: jpgRes.status === 400 && jpgRes.json.error === "image_too_small",
    },
    gif: {
      status: gifRes.status,
      error: gifRes.json.error ?? null,
      data: gifRes.json.data
        ? {
            width: gifRes.json.data.width,
            height: gifRes.json.data.height,
            mime: gifRes.json.data.mime,
            path: gifRes.json.data.path,
            storedAsGif: gifRes.json.data.mime === "image/gif",
            safeName: /^i[a-z0-9]+\.gif$/i.test(gifRes.json.data.path.split("/").pop() ?? ""),
          }
        : null,
      ok: gifRes.status === 200 && gifRes.json.data?.mime === "image/gif",
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.jpg.ok || !report.gif.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
