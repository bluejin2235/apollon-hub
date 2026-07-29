import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { extractFirstUrl } from "@/lib/research/types";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  summary: string | null;
  apollon_insight: string | null;
};

type RoomRow = {
  id: string;
  name: string | null;
  week_label: string;
};

const LUNA_PIN_REPLY_CONTENT = "📌 위클리 후보로 등록했어요!";

/** 동일 URL이 최근 며칠 내 이미 후보로 등록되어 있으면 중복 적재하지 않는다. */
const DUPLICATE_URL_WINDOW_DAYS = 14;

function extractTitleFromContent(content: string): string | null {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstLine) {
    const withoutBold = firstLine.replace(/\*\*/g, "").trim();
    if (withoutBold) return withoutBold;
  }

  const trimmed = content.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

async function resolvePinCandidateUrl(
  admin: SupabaseClient,
  messageRow: MessageRow,
  roomId: string
): Promise<string | null> {
  const metadataUrl = messageRow.metadata?.url;
  if (typeof metadataUrl === "string" && metadataUrl.trim()) {
    return metadataUrl.trim();
  }

  const contentUrl = extractFirstUrl(messageRow.content);
  if (contentUrl) return contentUrl;

  const { data: recentMessages, error: recentError } = await admin
    .from("trend_messages")
    .select("message_type, content, metadata, created_at")
    .eq("room_id", roomId)
    .neq("id", messageRow.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (recentError) {
    console.error("[research/pin] recent room message lookup failed", recentError);
    return null;
  }

  for (const row of recentMessages ?? []) {
    const meta = (row.metadata ?? null) as Record<string, unknown> | null;
    const metaUrl = meta?.url;
    if (typeof metaUrl === "string" && metaUrl.trim()) {
      return metaUrl.trim();
    }
    if (row.message_type === "link") {
      const linkUrl = extractFirstUrl(typeof row.content === "string" ? row.content : "");
      if (linkUrl) return linkUrl;
    }
  }

  return null;
}

/** 핀 등록된 루나 채팅 분석을 trend_editor_candidates에 후보로 적재한다. 실패해도 핀 등록 자체는 성공 처리한다. */
async function registerWeeklyPinAsEditorCandidate(
  admin: SupabaseClient,
  params: {
    roomId: string;
    messageRow: MessageRow;
    summary: string | null;
    insight: string | null;
    room: RoomRow | null;
  }
): Promise<void> {
  try {
    const { roomId, messageRow, summary, insight, room } = params;

    const url = await resolvePinCandidateUrl(admin, messageRow, roomId);

    if (url) {
      const dupWindowStart = new Date(
        Date.now() - DUPLICATE_URL_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: existing, error: dupCheckError } = await admin
        .from("trend_editor_candidates")
        .select("id")
        .eq("url", url)
        .gte("created_at", dupWindowStart)
        .maybeSingle();

      if (dupCheckError) {
        console.error("[research/pin] duplicate url check failed", dupCheckError);
      } else if (existing) {
        return;
      }
    }

    const metadataTitle = messageRow.metadata?.title;
    const title =
      (typeof metadataTitle === "string" && metadataTitle.trim()) ||
      extractTitleFromContent(messageRow.content) ||
      "루나 위클리 후보";

    const sourceName = room?.name?.trim() || room?.week_label?.trim() || "나와루나";

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const batchId = `luna_${roomId.slice(0, 8)}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const batchLabel = `루나채팅_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

    const { error: candidateInsertError } = await admin.from("trend_editor_candidates").insert({
      batch_id: batchId,
      batch_label: batchLabel,
      title,
      url,
      summary: summary ?? null,
      insight: insight ?? null,
      source_type: "나와루나",
      source_name: sourceName,
      part: "content",
      is_selected: false,
      is_sent: false
    });

    if (candidateInsertError) {
      console.error("[research/pin] editor candidate insert failed", candidateInsertError);
    }
  } catch (error) {
    console.error("[research/pin] editor candidate registration failed", error);
  }
}

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
      .select("id, is_pinned, summary, apollon_insight")
      .eq("message_id", messageId)
      .maybeSingle();

    if (analysisError) {
      console.error("[research/pin] analysis lookup failed", analysisError);
      return NextResponse.json({ error: analysisError.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    let pinned: boolean;
    let analysisSummary: string | null;
    let analysisInsight: string | null;

    if (analysis) {
      const analysisRow = analysis as AnalysisRow;
      pinned = !analysisRow.is_pinned;
      analysisSummary = analysisRow.summary;
      analysisInsight = analysisRow.apollon_insight;

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
      analysisSummary = messageRow.content.trim().slice(0, 2000) || "AI 분석";
      analysisInsight = null;

      const { error: insertError } = await admin.from("trend_analyses").insert({
        message_id: messageId,
        summary: analysisSummary,
        keywords: [],
        relevance_score: null,
        apollon_insight: analysisInsight,
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
      const { data: room, error: roomError } = await admin
        .from("trend_rooms")
        .select("id, name, week_label")
        .eq("id", roomId)
        .maybeSingle();

      if (roomError) {
        console.error("[research/pin] room lookup failed", roomError);
      }

      await registerWeeklyPinAsEditorCandidate(admin, {
        roomId,
        messageRow,
        summary: analysisSummary,
        insight: analysisInsight,
        room: (room as RoomRow | null) ?? null
      });

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
