/**
 * 10MB+ 업로드 — hub 프록시 경유
 * npx tsx scripts/verify-upload-large.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";

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

function makeFakeMp4(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.write("ftyp", 4);
  buf.write("isom", 8);
  randomBytes(Math.min(sizeBytes - 12, 1024)).copy(buf, 12);
  return buf;
}

async function uploadViaHub(
  token: string,
  buffer: Buffer,
  name: string,
  mime: string,
  role?: string
) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], name, { type: mime }));
  form.append("bucket", "works");
  form.append("path", `verify/large-upload/${Date.now()}/${name}`);
  if (role) form.append("role", role);

  const res = await fetch(`${HUB_URL}/api/website/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await createSession(admin, anonKey, supabaseUrl, await pickAdminEmail(admin));
  const token = session.access_token;

  const gif = await sharp({
    create: { width: 1920, height: 1080, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } }
  })
    .gif()
    .toBuffer();

  const mp4 = makeFakeMp4(11 * 1024 * 1024);

  const gifRes = await uploadViaHub(token, gif, "verify-large.gif", "image/gif", "body");
  const mp4Res = await uploadViaHub(token, mp4, "verify-large.mp4", "video/mp4");

  const gifData = (gifRes.json as { data?: { mime?: string; path?: string } })?.data;
  const mp4Data = (mp4Res.json as { data?: { mime?: string; path?: string; size?: number } })?.data;

  const report = {
    gif: {
      status: gifRes.status,
      error: (gifRes.json as { error?: string })?.error ?? null,
      message: (gifRes.json as { details?: { message?: string } })?.details?.message ?? null,
      mime: gifData?.mime ?? null,
      path: gifData?.path ?? null
    },
    mp4: {
      status: mp4Res.status,
      error: (mp4Res.json as { error?: string })?.error ?? null,
      message: (mp4Res.json as { details?: { message?: string } })?.details?.message ?? null,
      size: mp4Data?.size ?? null,
      path: mp4Data?.path ?? null
    }
  };
  console.log(JSON.stringify(report, null, 2));

  const ok = gifRes.status === 200 && gifData?.mime === "image/gif" && mp4Res.status === 200;
  if (!ok) {
    process.exitCode = 1;
    console.error("VERIFY_FAIL");
  } else {
    console.log("VERIFY_OK");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
