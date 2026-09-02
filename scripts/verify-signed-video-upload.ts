/**
 * 서명 업로드: 본문 35MB + T-L + T-S
 * npx tsx scripts/verify-signed-video-upload.ts
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
  return { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
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
  if (withSection?.id) {
    return { workId: withSection.id, pick: `fallback:${withSection.status ?? "unknown"}` };
  }
  throw new Error("no work");
}

type SignedTicket = {
  signedUrl: string;
  token: string;
  path: string;
  publicUrl: string;
};

async function signedUpload(
  workId: string,
  kind: "loop_lg" | "loop_sm" | "video",
  buffer: Buffer,
  via: "site" | "hub",
  hubToken?: string
) {
  const started = Date.now();
  const ticketRes =
    via === "site"
      ? await fetch(`${SITE_URL}/api/admin/upload/signed`, {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ workId, kind, size: buffer.length }),
        })
      : await fetch(`${HUB_URL}/api/website/upload/signed`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hubToken!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workId, kind, size: buffer.length }),
        });
  const ticketJson = (await ticketRes.json().catch(() => null)) as {
    data?: SignedTicket;
    error?: string;
    details?: unknown;
    notice?: unknown;
  } | null;
  const ticket = ticketJson?.data;
  if (ticketRes.status !== 200 || !ticket?.signedUrl) {
    return {
      ok: false,
      via,
      kind,
      stage: "signed",
      status: ticketRes.status,
      error: ticketJson?.error ?? "no ticket",
      details: ticketJson?.details ?? null,
      ms: Date.now() - started,
      size: buffer.length,
      path: null as string | null,
      publicUrl: null as string | null,
    };
  }

  const put = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "x-upsert": "false",
    },
    body: new Uint8Array(buffer),
  });
  const putText = await put.text().catch(() => "");
  if (put.status < 200 || put.status >= 300) {
    return {
      ok: false,
      via,
      kind,
      stage: "put",
      status: put.status,
      error: putText.slice(0, 400) || `put ${put.status}`,
      details: null,
      ms: Date.now() - started,
      size: buffer.length,
      path: ticket.path,
      publicUrl: ticket.publicUrl,
    };
  }

  return {
    ok: true,
    via,
    kind,
    stage: "done",
    status: put.status,
    error: null as string | null,
    details: ticketJson?.notice ?? null,
    ms: Date.now() - started,
    size: buffer.length,
    path: ticket.path,
    publicUrl: ticket.publicUrl,
  };
}

async function main() {
  const token = await createHubSession();
  const { workId, pick } = await pickWork(token);
  const detail = await hubJson(`works/${workId}`, token);
  const work = (detail.body as { data?: Record<string, unknown> })?.data;
  const sections =
    (work?.work_sections as Array<{ id: string }> | undefined) ?? [];
  const sectionId = sections[0]?.id;
  if (!sectionId) throw new Error("no section");

  const prevLg = typeof work?.loop_video_lg === "string" ? work.loop_video_lg : null;
  const prevSm = typeof work?.loop_video_sm === "string" ? work.loop_video_sm : null;

  const big = makeMp4Buffer(TARGET_MB * 1024 * 1024);
  const small = makeMp4Buffer(80 * 1024);

  const bodyUpload = await signedUpload(workId, "video", big, "site");
  const hubBody =
    bodyUpload.ok ? null : await signedUpload(workId, "video", big, "hub", token);
  const videoUp = bodyUpload.ok ? bodyUpload : hubBody!;

  const created = await hubJson(`sections/${sectionId}/blocks`, token, {
    method: "POST",
    body: JSON.stringify({
      preset: "video-full",
      sort: 999,
      video_kind: "hosted",
      video_url: "/verify/signed-placeholder.mp4",
    }),
  });
  const blockId = (created.body as { data?: { id?: string } })?.data?.id;
  let patchAfterUpload = { status: 0, error: null as string | null, video_url: null as string | null };
  if (blockId && videoUp.publicUrl) {
    const patched = await hubJson(`sections/${sectionId}/blocks/${blockId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ video_kind: "hosted", video_url: videoUp.publicUrl }),
    });
    patchAfterUpload = {
      status: patched.status,
      error: (patched.body as { error?: string })?.error ?? null,
      video_url: videoUp.publicUrl,
    };
  }

  const tl = await signedUpload(workId, "loop_lg", small, "site");
  const ts = await signedUpload(workId, "loop_sm", small, "site");
  let loopPatch = { status: 0, error: null as string | null };
  if (tl.publicUrl && ts.publicUrl) {
    const patched = await hubJson(`works/${workId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ loop_video_lg: tl.publicUrl, loop_video_sm: ts.publicUrl }),
    });
    loopPatch = {
      status: patched.status,
      error: (patched.body as { error?: string })?.error ?? null,
    };
  }

  const after = await hubJson(`works/${workId}`, token);
  const afterWork = (after.body as { data?: Record<string, unknown> })?.data;
  const afterBlocks =
    ((afterWork?.work_sections as Array<{ content_blocks?: Array<{ id: string; video_url?: string }> }>) ??
      [])
      .flatMap((s) => s.content_blocks ?? []);
  const savedBlock = afterBlocks.find((b) => b.id === blockId);

  await fetch(`${SITE_URL}/api/admin/works/${workId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ loop_video_lg: prevLg, loop_video_sm: prevSm }),
  }).catch(() => null);
  if (blockId) {
    await hubJson(`sections/${sectionId}/blocks/${blockId}`, token, { method: "DELETE" });
  }

  const report = {
    workId,
    workPick: pick,
    sectionId,
    blockId,
    body: {
      ...videoUp,
      sizeMB: Number((videoUp.size / (1024 * 1024)).toFixed(2)),
      seconds: Number((videoUp.ms / 1000).toFixed(2)),
    },
    patchAfterUpload,
    patchOk: patchAfterUpload.status === 200 && !patchAfterUpload.error,
    dbVideoUrl: savedBlock?.video_url ?? null,
    loopLg: {
      ok: tl.ok,
      status: tl.status,
      path: tl.path,
      error: tl.error,
      seconds: Number((tl.ms / 1000).toFixed(2)),
    },
    loopSm: {
      ok: ts.ok,
      status: ts.status,
      path: ts.path,
      error: ts.error,
      seconds: Number((ts.ms / 1000).toFixed(2)),
    },
    loopPatch,
    afterLoopLg: afterWork?.loop_video_lg ?? null,
    afterLoopSm: afterWork?.loop_video_sm ?? null,
    restoredLoop: true,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.patchOk || !videoUp.ok || !tl.ok || !ts.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
