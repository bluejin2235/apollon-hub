import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { buildHubEmailShell, buildItemCard } from "@/lib/mail/hub-email";
import { isRestaurantReactionEmoji } from "@/lib/restaurants/reactions";

const HUB_RESTAURANTS_BASE = "https://hub.apollonworks.com/restaurants";

type ReactBody = {
  restaurant_id: string;
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

    let body: ReactBody;
    try {
      body = (await request.json()) as ReactBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const restaurantId = body.restaurant_id?.trim();
    const emoji = body.emoji?.trim();
    if (!restaurantId || !emoji || !isRestaurantReactionEmoji(emoji)) {
      return NextResponse.json({ error: "restaurant_id and valid emoji are required" }, { status: 400 });
    }

    const { data: existing, error: findError } = await admin
      .from("restaurant_reactions")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("profile_id", user.id)
      .eq("emoji", emoji)
      .maybeSingle();

    if (findError) {
      console.error("[restaurants/react] find failed", findError);
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (existing) {
      const { error: deleteError } = await admin.from("restaurant_reactions").delete().eq("id", existing.id);
      if (deleteError) {
        console.error("[restaurants/react] delete failed", deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
      return NextResponse.json({ action: "removed", emoji });
    }

    const { error: insertError } = await admin.from("restaurant_reactions").insert({
      restaurant_id: restaurantId,
      profile_id: user.id,
      emoji
    });

    if (insertError) {
      console.error("[restaurants/react] insert failed", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("id, name, registered_by")
      .eq("id", restaurantId)
      .maybeSingle();

    if (restaurantError) {
      console.error("[restaurants/react] restaurant fetch failed", restaurantError);
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const ownerId = (restaurant?.registered_by as string | null) ?? null;
    if (!restaurant || !ownerId || ownerId === user.id) {
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      console.error("[restaurants/react] Resend env vars missing");
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const [{ data: reactorProfile }, { data: ownerProfile }] = await Promise.all([
      admin.from("profiles").select("id, name, email").eq("id", user.id).maybeSingle(),
      admin.from("profiles").select("id, name, email").eq("id", ownerId).maybeSingle()
    ]);

    const ownerEmail = ownerProfile?.email?.trim().toLowerCase();
    if (!ownerEmail) {
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    const reactorName = reactorProfile?.name?.trim() || "—";
    const restaurantName = String(restaurant.name ?? "").trim() || "—";
    const subject = `[아폴론 Hub] 맛집 반응 알림 — ${restaurantName}`;
    const html = buildHubEmailShell({
      title: `${emoji} 맛집 반응 알림`,
      subtitle: `${reactorName}님이 ${restaurantName}에 ${emoji} 반응을 남겼습니다.`,
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
      to: ownerEmail,
      subject,
      html
    });

    if (sendError) {
      console.error("[restaurants/react] Resend failed", sendError);
      return NextResponse.json({ action: "added", emoji, emailSkipped: true });
    }

    return NextResponse.json({ action: "added", emoji, emailSent: true });
  } catch (e) {
    console.error("[restaurants/react] unexpected error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
