import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildDigestItemRow,
  buildHubEmailShell,
  EMAIL_HEADER_DIGEST,
  escapeHtml,
  KST_OFFSET_MS,
  toKstDateString
} from "@/lib/mail/hub-email";
import { restaurantPrimaryCategory } from "@/lib/restaurants/types";

type ProfileJoin = { name: string | null } | { name: string | null }[] | null;

function joinName(profile: ProfileJoin): string {
  if (!profile) return "—";
  const row = Array.isArray(profile) ? profile[0] : profile;
  const name = row?.name?.trim();
  return name || "—";
}

function formatKstDateLabel(utcMs: number): string {
  return toKstDateString(utcMs);
}

/**
 * KST 09:00 cron 기준:
 * - 토/일: skip (발송 안 함)
 * - 월요일: 금~일(3일) 합산
 * - 화~금: 어제 KST 00:00 ~ 오늘 KST 00:00 (UTC = KST - 9h)
 */
function getKstDigestWindow(): {
  startIso: string;
  endIso: string;
  dateLabelKst: string;
  skip: boolean;
} {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const dayOfWeek = kstNow.getUTCDay(); // 0=일, 1=월, ..., 6=토

  const todayKstMidnightUtcMs = Date.UTC(y, m, d) - KST_OFFSET_MS;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { skip: true, startIso: "", endIso: "", dateLabelKst: "" };
  }

  if (dayOfWeek === 1) {
    const startKstMidnightUtcMs = todayKstMidnightUtcMs - 3 * 24 * 60 * 60 * 1000;
    const friLabel = formatKstDateLabel(startKstMidnightUtcMs);
    const sunLabel = formatKstDateLabel(todayKstMidnightUtcMs - 24 * 60 * 60 * 1000);
    const dateLabelKst = friLabel === sunLabel ? friLabel : `${friLabel} ~ ${sunLabel}`;

    return {
      skip: false,
      startIso: new Date(startKstMidnightUtcMs).toISOString(),
      endIso: new Date(todayKstMidnightUtcMs).toISOString(),
      dateLabelKst
    };
  }

  const startKstMidnightUtcMs = todayKstMidnightUtcMs - 24 * 60 * 60 * 1000;
  return {
    skip: false,
    startIso: new Date(startKstMidnightUtcMs).toISOString(),
    endIso: new Date(todayKstMidnightUtcMs).toISOString(),
    dateLabelKst: formatKstDateLabel(startKstMidnightUtcMs)
  };
}

function buildSection(sectionLabel: string, title: string, itemsHtml: string): string {
  return `<div style="margin-bottom: 20px;">
      <div style="margin-bottom: 12px;">
        <span style="display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; color: ${EMAIL_HEADER_DIGEST}; background: rgba(26,26,46,0.08); padding: 4px 10px; border-radius: 4px; margin-bottom: 6px;">${escapeHtml(sectionLabel)}</span>
        <div style="font-size: 14px; font-weight: 600; color: #5A5353;">${escapeHtml(title)}</div>
      </div>
      ${itemsHtml}
    </div>`;
}

const SECTION_DIVIDER =
  '<div style="border-top: 0.5px solid #E6CCBE; margin: 16px 0;"></div>';

function buildDigestHtml(params: {
  dateLabelKst: string;
  posts: { title: string; authorName: string }[];
  restaurants: { name: string; category: string; registererName: string }[];
  supplies: { name: string; code: string; managerName: string }[];
  licenses: { name: string; category: string; assigneeName: string }[];
}): string {
  const { dateLabelKst, posts, restaurants, supplies, licenses } = params;

  const sections: string[] = [];

  if (posts.length > 0) {
    const cards = posts
      .map((post) => buildDigestItemRow(post.title, post.authorName))
      .join("\n");
    sections.push(buildSection("HUB 게시판", `새 글 ${posts.length}건`, cards));
  }

  if (restaurants.length > 0) {
    const cards = restaurants
      .map((r) => buildDigestItemRow(r.name, `${r.category} · ${r.registererName}`))
      .join("\n");
    sections.push(buildSection("아슐랭", `신규 맛집 ${restaurants.length}건`, cards));
  }

  if (supplies.length > 0) {
    const cards = supplies
      .map((s) => buildDigestItemRow(s.name, `${s.code} · ${s.managerName}`))
      .join("\n");
    sections.push(buildSection("물품관리", `신규 등록 ${supplies.length}건`, cards));
  }

  if (licenses.length > 0) {
    const cards = licenses
      .map((l) => buildDigestItemRow(l.name, `${l.category} · ${l.assigneeName}`))
      .join("\n");
    sections.push(buildSection("라이선스", `신규 등록 ${licenses.length}건`, cards));
  }

  const bodySections = sections.join(`\n${SECTION_DIVIDER}\n`);
  const allEmpty =
    posts.length === 0 &&
    restaurants.length === 0 &&
    supplies.length === 0 &&
    licenses.length === 0;
  const emptyMessage = allEmpty
    ? `<p style="color: #776274; font-size: 14px; text-align: center; padding: 20px 0;">
    어제의 새로운 소식이 없습니다.
  </p>`
    : "";

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_DIGEST,
    headerLabel: "APOLLON HUB · 일간 소식",
    title: "아폴론 Hub 일간 소식",
    subtitle: `${dateLabelKst} 기준`,
    bodyHtml: `${bodySections}${emptyMessage}`,
    cta: { href: "https://hub.apollonworks.com/hub", label: "Hub 바로가기" }
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[daily-digest] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!supabaseUrl || !secretKey) {
    console.error("[daily-digest] Supabase env vars missing");
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  if (!resendApiKey || !fromEmail) {
    console.error("[daily-digest] Resend env vars missing");
    return NextResponse.json({ error: "Resend environment variables missing" }, { status: 500 });
  }

  const { startIso, endIso, dateLabelKst, skip } = getKstDigestWindow();
  if (skip) {
    console.log("[daily-digest] skipped — weekend (no send on Sat/Sun KST)");
    return NextResponse.json({ success: true, skipped: true, reason: "weekend" });
  }
  console.log("[daily-digest] window", { startIso, endIso, dateLabelKst });

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [postsRes, restaurantsRes, profilesRes, suppliesRes, licensesRes] = await Promise.all([
    supabase
      .from("hub_posts")
      .select("id, title, author:profiles!author_id(name)")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("restaurants")
      .select("id, name, categories, registerer:profiles!registered_by(name)")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("email, name").eq("status", "근무"),
    supabase
      .from("supplies")
      .select("id, name, code, manager:profiles!manager_id(name)")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("services")
      .select("id, name, category, assignee:profiles!assignee_id(name)")
      .eq("is_hub_card", false)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
  ]);

  if (postsRes.error) {
    console.error("[daily-digest] hub_posts fetch failed", postsRes.error);
    return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  }
  if (restaurantsRes.error) {
    console.error("[daily-digest] restaurants fetch failed", restaurantsRes.error);
    return NextResponse.json({ error: restaurantsRes.error.message }, { status: 500 });
  }
  if (profilesRes.error) {
    console.error("[daily-digest] profiles fetch failed", profilesRes.error);
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }
  if (suppliesRes.error) {
    console.error("[daily-digest] supplies fetch failed", suppliesRes.error);
    return NextResponse.json({ error: suppliesRes.error.message }, { status: 500 });
  }
  if (licensesRes.error) {
    console.error("[daily-digest] licenses fetch failed", licensesRes.error);
    return NextResponse.json({ error: licensesRes.error.message }, { status: 500 });
  }

  const posts = (postsRes.data ?? []).map((row) => ({
    title: String(row.title ?? ""),
    authorName: joinName(row.author as ProfileJoin)
  }));

  const restaurants = (restaurantsRes.data ?? []).map((row) => ({
    name: String(row.name ?? ""),
    category: restaurantPrimaryCategory({ categories: row.categories ?? [] }),
    registererName: joinName(row.registerer as ProfileJoin)
  }));

  const supplies = (suppliesRes.data ?? []).map((row) => ({
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
    managerName: joinName(row.manager as ProfileJoin)
  }));

  const licenses = (licensesRes.data ?? []).map((row) => ({
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    assigneeName: joinName(row.assignee as ProfileJoin)
  }));

  const recipients = ["ms@apollonworks.com"];
  // TODO: 테스트 완료 후 아래 주석 해제하고 위 고정 이메일 제거
  // const recipients = [...new Set(
  //   (profilesRes.data ?? [])
  //     .map((p) => p.email?.trim().toLowerCase())
  //     .filter((email): email is string => Boolean(email))
  // )];

  if (recipients.length === 0) {
    console.log("[daily-digest] skipped — no recipient emails");
    return NextResponse.json({
      success: true,
      posts: posts.length,
      restaurants: restaurants.length,
      supplies: supplies.length,
      licenses: licenses.length,
      recipients: 0,
      skipped: true
    });
  }

  const html = buildDigestHtml({ dateLabelKst, posts, restaurants, supplies, licenses });
  const subject = `[아폴론 Hub] 오늘의 소식 — ${dateLabelKst}`;

  const resend = new Resend(resendApiKey);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html
  });

  if (error) {
    console.error("[daily-digest] Resend failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log("[daily-digest] sent", {
    messageId: data?.id,
    posts: posts.length,
    restaurants: restaurants.length,
    supplies: supplies.length,
    licenses: licenses.length,
    recipients: recipients.length
  });

  return NextResponse.json({
    success: true,
    posts: posts.length,
    restaurants: restaurants.length,
    supplies: supplies.length,
    licenses: licenses.length,
    recipients: recipients.length
  });
}
