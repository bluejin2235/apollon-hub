import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

type PinBody = {
  message_id: string;
  room_id: string;
};

type MessageRow = {
  id: string;
  room_id: string;
  message_type: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

type AnalysisRow = {
  id: string;
  is_pinned: boolean | null;
};

const LUNA_PIN_REPLY_CONTENT = "📌 위클리 후보로 등록했어요!";

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

    let body: PinBody;
    try {
      body = (await request.json()) as PinBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const messageId = body.message_id?.trim();
    const roomId = body.room_id?.trim();

    if (!messageId || !roomId) {
      return NextResponse.json({ error: "message_id and room_id are required" }, { status: 400 });
    }

    const { data: message, error: messageError } = await admin
      .from("trend_messages")
      .select("id, room_id, message_type, content, metadata")
      .eq("id", messageId)
      .eq("room_id", roomId)
      .maybeSingle();

    if (messageError) {
      console.error("[research/pin] message lookup failed", messageError);
      return NextResponse.json({ error: messageError.message }, { status: 500 });
    }

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const messageRow = message as MessageRow;
    if (messageRow.message_type !== "ai") {
      return NextResponse.json({ error: "Only AI messages can be pinned" }, { status: 400 });
    }

    const { data: analysis, error: analysisError } = await admin
      .from("trend_analyses")
      .select("id, is_pinned")
      .eq("message_id", messageId)
      .maybeSingle();

    if (analysisError) {
      console.error("[research/pin] analysis lookup failed", analysisError);
      return NextResponse.json({ error: analysisError.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    let pinned: boolean;

    if (analysis) {
      const analysisRow = analysis as AnalysisRow;
      pinned = !analysisRow.is_pinned;

      const { error: updateError } = await admin
        .from("trend_analyses")
        .update({
          is_pinned: pinned,
          pinned_at: pinned ? now : null
        })
        .eq("id", analysisRow.id);

      if (updateError) {
        console.error("[research/pin] analysis update failed", updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      pinned = true;

      const { error: insertError } = await admin.from("trend_analyses").insert({
        message_id: messageId,
        summary: messageRow.content.trim().slice(0, 2000) || "AI 분석",
        keywords: [],
        relevance_score: null,
        apollon_insight: null,
        is_pinned: true,
        pinned_at: now
      });

      if (insertError) {
        console.error("[research/pin] analysis insert failed", insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    const existingMeta = messageRow.metadata ?? {};
    const { error: metaError } = await admin
      .from("trend_messages")
      .update({
        metadata: { ...existingMeta, is_pinned: pinned }
      })
      .eq("id", messageId);

    if (metaError) {
      console.error("[research/pin] message metadata update failed", metaError);
      return NextResponse.json({ error: metaError.message }, { status: 500 });
    }

    if (pinned) {
      const { error: lunaReplyError } = await admin.from("trend_messages").insert({
        room_id: roomId,
        profile_id: null,
        content: LUNA_PIN_REPLY_CONTENT,
        message_type: "ai",
        metadata: { ai_model: "pin-confirmation" }
      });

      if (lunaReplyError) {
        console.error("[research/pin] luna reply insert failed", lunaReplyError);
      }
    }

    return NextResponse.json({ success: true, pinned });
  } catch (error) {
    console.error("[research/pin]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
