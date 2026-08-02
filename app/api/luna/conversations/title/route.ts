import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { maybeGenerateConversationTitle } from "@/lib/luna/conversation-title";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  let body: { conversation_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string"
      ? body.conversation_id.trim()
      : "";
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversation_id is required" },
      { status: 400 }
    );
  }

  const { data: conv, error: convError } = await admin
    .from("luna_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const title = await maybeGenerateConversationTitle(admin, conversationId);
    return NextResponse.json({ title: title ?? null });
  } catch (err) {
    console.error("[luna/conversations/title]", err);
    return NextResponse.json({ title: null });
  }
}
