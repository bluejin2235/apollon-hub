import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

type PatchBody = {
  message_id?: string;
  feedback?: string;
};

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  if (!messageId || (feedback !== "good" && feedback !== "bad")) {
    return NextResponse.json(
      { error: "message_id and feedback ('good'|'bad') are required" },
      { status: 400 }
    );
  }

  const { data: message, error: msgError } = await admin
    .from("luna_messages")
    .select("id, conversation_id, metadata")
    .eq("id", messageId)
    .maybeSingle();

  if (msgError) {
    console.error("[luna/messages] select", msgError);
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }
  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id")
    .eq("id", message.conversation_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/messages] conversation", convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prevMeta =
    message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : {};

  const { error: updateError } = await admin
    .from("luna_messages")
    .update({ metadata: { ...prevMeta, feedback } })
    .eq("id", messageId);

  if (updateError) {
    console.error("[luna/messages] update", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, feedback });
}
