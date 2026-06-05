import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type ProfileJoin = { name: string | null } | { name: string | null }[] | null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function joinName(profile: ProfileJoin): string {
  if (!profile) return "—";
  const row = Array.isArray(profile) ? profile[0] : profile;
  const name = row?.name?.trim();
  return name || "—";
}

/** 어제 KST 00:00 ~ 오늘 KST 00:00 (UTC = KST - 9h) */
function getKstDigestWindow(): { startIso: string; endIso: string; dateLabelKst: string } {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();

  const todayKstMidnightUtcMs = Date.UTC(y, m, d) - KST_OFFSET_MS;
  const yesterdayKstMidnightUtcMs = todayKstMidnightUtcMs - 24 * 60 * 60 * 1000;

  const yesterdayKst = new Date(yesterdayKstMidnightUtcMs + KST_OFFSET_MS);
  const dateLabelKst = `${yesterdayKst.getUTCFullYear()}년 ${yesterdayKst.getUTCMonth() + 1}월 ${yesterdayKst.getUTCDate()}일`;

  return {
    startIso: new Date(yesterdayKstMidnightUtcMs).toISOString(),
    endIso: new Date(todayKstMidnightUtcMs).toISOString(),
    dateLabelKst
  };
}

function buildDigestHtml(params: {
  dateLabelKst: string;
  posts: { title: string; authorName: string }[];
  restaurants: { name: string; category: string; registererName: string }[];
  supplies: { name: string; code: string; managerName: string }[];
  licenses: { name: string; category: string; assigneeName: string }[];
}): string {
  const { dateLabelKst, posts, restaurants, supplies, licenses } = params;
  const parts: string[] = [
    "<h2>아폴론 Hub 일간 소식</h2>",
    `<p>${escapeHtml(dateLabelKst)} 기준</p>`
  ];

  if (posts.length > 0) {
    parts.push(`<h3>게시판 새 글 ${posts.length}건</h3>`, "<ul>");
    for (const post of posts) {
      parts.push(
        `<li>${escapeHtml(post.authorName)}: ${escapeHtml(post.title)}</li>`
      );
    }
    parts.push("</ul>");
  }

  if (restaurants.length > 0) {
    parts.push(`<h3>새 맛집 ${restaurants.length}건</h3>`, "<ul>");
    for (const r of restaurants) {
      parts.push(
        `<li>${escapeHtml(r.registererName)} 등록: ${escapeHtml(r.name)} (${escapeHtml(r.category)})</li>`
      );
    }
    parts.push("</ul>");
  }

  if (supplies.length > 0) {
    parts.push(`<h3>새 물품 ${supplies.length}건</h3>`, "<ul>");
    for (const s of supplies) {
      parts.push(
        `<li>${escapeHtml(s.managerName)} 등록: ${escapeHtml(s.name)} (${escapeHtml(s.code)})</li>`
      );
    }
    parts.push("</ul>");
  }

  if (licenses.length > 0) {
    parts.push(`<h3>새 라이선스 ${licenses.length}건</h3>`, "<ul>");
    for (const l of licenses) {
      parts.push(
        `<li>${escapeHtml(l.assigneeName)} 등록: ${escapeHtml(l.name)} (${escapeHtml(l.category)})</li>`
      );
    }
    parts.push("</ul>");
  }

  parts.push('<p><a href="https://apollon-hub.vercel.app/hub">Hub 바로가기</a></p>');
  return parts.join("\n");
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

  const { startIso, endIso, dateLabelKst } = getKstDigestWindow();
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
      .select("id, name, category, registerer:profiles!registered_by(name)")
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
    category: String(row.category ?? ""),
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

  if (
    posts.length === 0 &&
    restaurants.length === 0 &&
    supplies.length === 0 &&
    licenses.length === 0
  ) {
    console.log("[daily-digest] skipped — no digest content in window");
    return NextResponse.json({
      success: true,
      posts: 0,
      restaurants: 0,
      supplies: 0,
      licenses: 0,
      recipients: 0,
      skipped: true
    });
  }

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
