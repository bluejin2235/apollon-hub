/**
 * 저장/공개 API 왕복 — hide · unhide · 사이트 노출
 * npx tsx scripts/verify-publish-save-api.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";

const HUB_URL = process.env.LUNA_UI_BASE_URL ?? "http://localhost:3000";
const SITE_URL = process.env.WEBSITE_API_URL ?? "http://localhost:3100";
const TEST_SLUG = "trendyyouth-town-media-architecture-concept-old";

async function createSession(
  admin: ReturnType<typeof createClient>,
  anonKey: string,
  supabaseUrl: string,
  email: string,
) {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) throw new Error(linkErr?.message ?? "no token");
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function hubFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${HUB_URL}/api/website/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function siteOk(slug: string) {
  const res = await fetch(`${SITE_URL}/works/${slug}`, { redirect: "manual" });
  return res.status === 200;
}

async function main() {
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
  if (!profile?.email) throw new Error("no admin");

  const session = await createSession(admin, anonKey, supabaseUrl, profile.email);
  const token = session.access_token;

  const list = await hubFetch(`works?q=${encodeURIComponent(TEST_SLUG)}&limit=5`, token);
  const work = (list.body as { data?: { items?: Array<{ id: string; slug: string; site_visibility?: string }> } })
    ?.data?.items?.find((item) => item.slug === TEST_SLUG);
  if (!work?.id) throw new Error("work_not_found");

  const wasHidden = work.site_visibility === "hidden";
  const report: Record<string, unknown> = { slug: TEST_SLUG, workId: work.id, wasHidden };

  if (wasHidden) {
    await hubFetch("unhide", token, {
      method: "POST",
      body: JSON.stringify({ contentType: "work", contentId: work.id }),
    });
  }

  report.onSiteLive = await siteOk(TEST_SLUG);

  const preview = await hubFetch("publish/preview", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: work.id }),
  });
  report.previewOk = preview.ok;
  report.preview = preview.body;

  const hide = await hubFetch("hide", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: work.id }),
  });
  report.hideOk = hide.ok;
  report.onSiteHidden = !(await siteOk(TEST_SLUG));

  const unhide = await hubFetch("unhide", token, {
    method: "POST",
    body: JSON.stringify({ contentType: "work", contentId: work.id }),
  });
  report.unhideOk = unhide.ok;
  report.onSiteRestored = await siteOk(TEST_SLUG);

  if (wasHidden) {
    await hubFetch("hide", token, {
      method: "POST",
      body: JSON.stringify({ contentType: "work", contentId: work.id }),
    });
  }

  console.log(JSON.stringify(report, null, 2));

  const failed =
    !report.onSiteLive ||
    !report.previewOk ||
    !report.hideOk ||
    !report.onSiteHidden ||
    !report.unhideOk ||
    !report.onSiteRestored;
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
