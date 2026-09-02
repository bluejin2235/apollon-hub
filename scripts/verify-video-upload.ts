/**
 * 영상 업로드 후 video_fields_required 없이 파일만 저장·공개 검증
 * npx tsx scripts/verify-video-upload.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

import { createClient } from "@supabase/supabase-js";

const HUB_URL = (process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SITE_URL = (process.env.WEBSITE_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const TARGET_MB = 35;

type WorkItem = { id: string; status?: string; counts?: { sections?: number } };

function adminHeaders() {
  const secret = process.env.ADMIN_API_SECRET?.trim() || process.env.WEBSITE_ADMIN_SECRET?.trim();
  if (!secret) throw new Error("no admin secret");
  return { Authorization: `Bearer ${secret}` };
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

async function createHubSession() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "슈퍼관리자")
    .limit(1)
    .maybeSingle();
  if (!profile?.email) throw new Error("no admin profile");

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
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
  return data.session.access_token;
}

async function hubJson(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${HUB_URL}/api/website/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function itemsFrom(body: unknown): WorkItem[] {
  return (body as { data?: { items?: WorkItem[] } })?.data?.items ?? [];
}

async function pickWork(token: string): Promise<{ workId: string; pick: string }> {
  const draft = await hubJson("works?status=draft&limit=20", token);
  const draftItems = itemsFrom(draft.body);
  const draftWithSection = draftItems.find((w) => (w.counts?.sections ?? 0) > 0) ?? draftItems[0];
  if (draftWithSection?.id) {
    return { workId: draftWithSection.id, pick: "draft" };
  }

  const all = await hubJson("works?limit=20", token);
  const allItems = itemsFrom(all.body);
  const withSection = allItems.find((w) => (w.counts?.sections ?? 0) > 0) ?? allItems[0];
  const KNOWN = "3cdc1043-8d3b-4f60-9d67-3283508f7e1d";
  if (withSection?.id) {
    return { workId: withSection.id, pick: `fallback:${withSection.status ?? "unknown"}` };
  }
  return { workId: KNOWN, pick: "known-work" };
}

async function uploadVideo(buffer: Buffer, via: "site" | "hub", token?: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], "verify-35mb.mp4", { type: "video/mp4" }));
  form.append("bucket", "works");
  form.append("path", `verify/video-upload/${Date.now()}/verify-35mb.mp4`);

  if (via === "site") {
    const res = await fetch(`${SITE_URL}/api/admin/upload`, {
      method: "POST",
      headers: adminHeaders(),
      body: form,
    });
    const json = await res.json();
    return { status: res.status, json, via: "site" as const };
  }

  const res = await fetch(`${HUB_URL}/api/website/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token!}` },
    body: form,
  });
  const json = await res.json();
  return { status: res.status, json, via: "hub" as const };
}

async function main() {
  const token = await createHubSession();
  const sizeBytes = TARGET_MB * 1024 * 1024;
  const mp4 = makeMp4Buffer(sizeBytes);

  const { workId, pick } = await pickWork(token);

  const detail = await hubJson(`works/${workId}`, token);
  const sections =
    (detail.body as { data?: { work_sections?: Array<{ id: string }> } })?.data?.work_sections ??
    [];
  const sectionId = sections[0]?.id;
  if (!sectionId) throw new Error("no section");

  const created = await hubJson(`sections/${sectionId}/blocks`, token, {
    method: "POST",
    body: JSON.stringify({
      preset: "video-full",
      sort: 999,
      video_kind: "hosted",
      // DB check content_blocks_shape requires url when kind is hosted
      video_url: "/verify/video-upload/placeholder.mp4",
    }),
  });
  const blockId = (created.body as { data?: { id?: string }; error?: string })?.data?.id;
  if (!blockId) {
    throw new Error(
      `block_create_failed status=${created.status} body=${JSON.stringify(created.body)}`,
    );
  }

  const siteUpload = await uploadVideo(mp4, "site");
  const hubUpload = siteUpload.status === 200 ? null : await uploadVideo(mp4, "hub", token);
  const upload = siteUpload.status === 200 ? siteUpload : hubUpload!;
  const uploadData = (upload.json as { data?: { path: string; publicUrl?: string } })?.data;
  const videoSrc = uploadData?.publicUrl || (uploadData?.path ? `/${uploadData.path}` : null);

  let patchAfterUpload = { status: 0, error: null as string | null };
  if (videoSrc) {
    const patched = await hubJson(`sections/${sectionId}/blocks/${blockId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ video_kind: "hosted", video_url: videoSrc }),
    });
    patchAfterUpload = {
      status: patched.status,
      error: (patched.body as { error?: string })?.error ?? null,
    };
  }

  const publishPreview = await hubJson("publish/preview", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: workId }),
  });

  await hubJson(`sections/${sectionId}/blocks/${blockId}`, token, { method: "DELETE" });

  const report = {
    workId,
    workPick: pick,
    sectionId,
    blockId,
    upload: {
      via: upload.via,
      status: upload.status,
      sizeMB: TARGET_MB,
      error: (upload.json as { error?: string })?.error ?? null,
      path: uploadData?.path ?? null,
    },
    patchAfterUpload,
    patchOk: patchAfterUpload.status === 200 && patchAfterUpload.error !== "video_fields_required",
    publishPreviewStatus: publishPreview.status,
    publishBlockedExpected: true,
    cleanup: "block deleted",
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.patchOk || upload.status !== 200) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
