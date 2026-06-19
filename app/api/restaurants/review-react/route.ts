import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { buildHubEmailShell, buildItemCard } from "@/lib/mail/hub-email";
import { isReviewReactionEmoji } from "@/lib/restaurants/reactions";

const HUB_RESTAURANTS_BASE = "https://hub.apollonworks.com/restaurants";

type ReviewReactBody = {
  review_id: string;
  emoji: string;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    let body: ReviewReactBody;
    try {
      body = (await request.json()) as ReviewReactBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const reviewId = body.review_id?.trim();
    const emoji = body.emoji?.trim();
    if (!reviewId || !emoji || !isReviewReactionEmoji(emoji)) {
      return NextResponse.json({ error: "review_id and valid emoji are required" }, { status: 400 });
    }

    const { data: existing, error: findError } = await admin
      .from("review_reactions")
      .select("id")
      .eq("review_id", reviewId)
      .eq("profile_id", user.id)
      .eq("emoji", emoji)
      .maybeSingle();

    if (findError) {
      console.error("[restaurants/review-react] find failed", findError);
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (existing) {
      const { error: deleteError } = await admin.from("review_reactions").delete().eq("id", existing.id);
      if (deleteError) {
        console.error("[restaurants/review-react] delete failed", deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
      return NextResponse.json({ action: "removed", emoji });
    }

    const { error: insertError } = await admin.from("review_reactions").insert({
      review_id: reviewId,
      profile_id: user.id,
      emoji
    });

    if (insertError) {
      console.error("[restaurants/review-react] insert failed", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { data: review, error: reviewError } = await admin
      .from("reviews")
      .select("id, restaurant_id, reviewer_id")
      .eq("id", reviewId)
      .maybeSingle();

    if (reviewError) {
      console.error("[restaurants/review-react] review fetch failed", reviewError);
      console.log("[review-react] skip: reviewError");
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const reviewerId = (review?.reviewer_id as string | null) ?? null;
    const restaurantId = (review?.restaurant_id as string | null) ?? null;
    if (!review || !reviewerId || !restaurantId) {
      console.log("[review-react] skip: no review or reviewerId or restaurantId", {
        review: !!review,
        reviewerId,
        restaurantId
      });
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      console.error("[restaurants/review-react] Resend env vars missing");
      console.log("[review-react] skip: resend env missing");
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const [{ data: reactorProfile }, { data: reviewerProfile }, { data: restaurant }] = await Promise.all([
      admin.from("profiles").select("id, name, email").eq("id", user.id).maybeSingle(),
      admin.from("profiles").select("id, name, email").eq("id", reviewerId).maybeSingle(),
      admin.from("restaurants").select("id, name").eq("id", restaurantId).maybeSingle()
    ]);

    const reviewerEmail = reviewerProfile?.email?.trim().toLowerCase();
    if (!reviewerEmail) {
      console.log("[review-react] skip: no reviewerEmail", { reviewerProfile });
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const reactorName = reactorProfile?.name?.trim() || "—";
    const restaurantName = String(restaurant?.name ?? "").trim() || "—";
    const subject = `[아폴론 Hub] 리뷰 반응 알림 — ${restaurantName}`;
    const html = buildHubEmailShell({
      title: `${emoji} 리뷰 반응 알림`,
      subtitle: `${reactorName}님이 회원님의 리뷰에 ${emoji} 반응을 남겼습니다.`,
      bodyHtml: [
        buildItemCard("맛집", restaurantName),
        buildItemCard("반응", emoji),
        buildItemCard("반응자", reactorName)
      ].join("\n"),
      cta: { href: `${HUB_RESTAURANTS_BASE}/${restaurantId}`, label: "맛집 상세 보기" }
    });

    const resend = new Resend(resendApiKey);
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: reviewerEmail,
      subject,
      html
    });

    if (sendError) {
      console.error("[restaurants/review-react] Resend failed", sendError);
      console.log("[review-react] skip: sendError", sendError);
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    return NextResponse.json({ action: "added", emoji, emailSent: true });
  } catch (e) {
    console.error("[restaurants/review-react] unexpected error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
