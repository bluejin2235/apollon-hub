import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildDigestItemRow,
  buildHubEmailShell,
  EMAIL_HEADER_DIGEST,
  escapeHtml,
  EXCLUDED_TEAM_EMAIL,
  KST_OFFSET_MS,
  toKstDateString
} from "@/lib/mail/hub-email";
import { restaurantPrimaryCategory } from "@/lib/restaurants/types";

type ProfileJoin = { name: string | null } | { name: string | null }[] | null;

type RestaurantJoin = { name: string | null } | { name: string | null }[] | null;

type ProfileRow = {
  id: string;
  email: string;
  name: string | null;
};

type ReviewDigestRow = {
  id: string;
  star_rating: number | null;
  restaurant_id: string;
  restaurant: RestaurantJoin;
  reviewer: ProfileJoin;
};

type ReviewDigestGroup = {
  restaurantName: string;
  reviewCount: number;
  reviewerNames: string;
  averageStarLabel: string;
};

function joinName(profile: ProfileJoin): string {
  if (!profile) return "—";
  const row = Array.isArray(profile) ? profile[0] : profile;
  const name = row?.name?.trim();
  return name || "—";
}

function joinRestaurantName(restaurant: RestaurantJoin): string {
  if (!restaurant) return "—";
  const row = Array.isArray(restaurant) ? restaurant[0] : restaurant;
  const name = row?.name?.trim();
  return name || "—";
}

function starRatingToScore(starRating: number | null): number | null {
  if (typeof starRating === "number" && Number.isFinite(starRating) && starRating >= 2 && starRating <= 10) {
    return starRating / 2;
  }
  return null;
}

function formatAverageStarLabel(average: number): string {
  const rounded = Math.round(average * 2) / 2;
  const label = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  return `★${label}`;
}

function groupReviewsByRestaurant(rows: ReviewDigestRow[]): ReviewDigestGroup[] {
  const grouped = new Map<
    string,
    { restaurantName: string; reviewerNames: string[]; starScores: number[] }
  >();

  for (const row of rows) {
    const restaurantId = row.restaurant_id;
    const restaurantName = joinRestaurantName(row.restaurant);
    const reviewerName = joinName(row.reviewer);
    const starScore = starRatingToScore(row.star_rating);

    const bucket = grouped.get(restaurantId) ?? {
      restaurantName,
      reviewerNames: [],
      starScores: []
    };

    bucket.reviewerNames.push(reviewerName);
    if (starScore !== null) {
      bucket.starScores.push(starScore);
    }

    grouped.set(restaurantId, bucket);
  }

  return [...grouped.values()].map((group) => {
    const average =
      group.starScores.length > 0
        ? group.starScores.reduce((sum, score) => sum + score, 0) / group.starScores.length
        : 0;

    return {
      restaurantName: group.restaurantName,
      reviewCount: group.reviewerNames.length,
      reviewerNames: group.reviewerNames.join(", "),
      averageStarLabel: formatAverageStarLabel(average)
    };
  });
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
  reviewGroups: ReviewDigestGroup[];
  totalReviewCount: number;
  supplies: { name: string; code: string; managerName: string }[];
  licenses: { name: string; category: string; assigneeName: string }[];
}): string {
  const { dateLabelKst, posts, restaurants, reviewGroups, totalReviewCount, supplies, licenses } = params;

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

  if (totalReviewCount > 0) {
    const cards = reviewGroups
      .map((group) =>
        buildDigestItemRow(group.restaurantName, `${group.reviewerNames} · ${group.averageStarLabel}`)
      )
      .join("\n");
    sections.push(buildSection("아슐랭", `리뷰 ${totalReviewCount}건`, cards));
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
    totalReviewCount === 0 &&
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

  const [postsRes, restaurantsRes, reviewsRes, profilesRes, suppliesRes, licensesRes] = await Promise.all([
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
    supabase
      .from("reviews")
      .select(
        "id, star_rating, restaurant_id, restaurant:restaurants!restaurant_id(name), reviewer:profiles!reviewer_id(name)"
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, email, name")
      .eq("status", "근무")
      .neq("email", EXCLUDED_TEAM_EMAIL)
      .not("email", "is", null),
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
  if (reviewsRes.error) {
    console.error("[daily-digest] reviews fetch failed", reviewsRes.error);
    return NextResponse.json({ error: reviewsRes.error.message }, { status: 500 });
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

  const reviewRows = (reviewsRes.data ?? []) as ReviewDigestRow[];
  const reviewGroups = groupReviewsByRestaurant(reviewRows);
  const totalReviewCount = reviewRows.length;

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

  const html = buildDigestHtml({
    dateLabelKst,
    posts,
    restaurants,
    reviewGroups,
    totalReviewCount,
    supplies,
    licenses
  });
  const subject = `[아폴론 Hub] 오늘의 소식 — ${dateLabelKst}`;

  const resend = new Resend(resendApiKey);
  let sent = 0;
  let skipped = 0;
  const errors: { profileId: string; error: string }[] = [];

  for (const profile of (profilesRes.data ?? []) as ProfileRow[]) {
    try {
      const email = profile.email?.trim().toLowerCase();
      if (!email) {
        skipped += 1;
        continue;
      }

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject,
        html
      });

      if (error) {
        console.error("[daily-digest] Resend failed", { profileId: profile.id, error });
        errors.push({ profileId: profile.id, error: error.message });
        continue;
      }

      sent += 1;
      console.log("[daily-digest] sent", {
        profileId: profile.id,
        email,
        messageId: data?.id,
        posts: posts.length,
        restaurants: restaurants.length,
        reviews: totalReviewCount,
        supplies: supplies.length,
        licenses: licenses.length
      });
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    sent,
    skipped,
    errors
  });
}
