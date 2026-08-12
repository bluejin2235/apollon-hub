import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  createCandidate,
  firstTurnFallback,
  makeTurn,
  runDialogueTurn
} from "@/lib/luna/candidates";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

function buildTeachDraft(
  messages: Array<{ role: string; content: string }>
): string {
  const userLines = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
  const lastUser = userLines[userLines.length - 1] ?? "";
  const firstUser = userLines[0] ?? "";
  if (lastUser.length > 20) return lastUser.slice(0, 280);
  if (firstUser) return `대화에서: ${firstUser}`.slice(0, 280);
  return "이 대화에서 배울 점을 정리해 주세요.";
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: { conversation_id?: string };
  try {
    body = (await request.json()) as { conversation_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const ownerId = conversation.user_id as string;

  const { data: messagesData, error: messagesError } = await admin
    .from("luna_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const messages = (messagesData ?? []) as Array<{ role: string; content: string }>;
  const draft = buildTeachDraft(messages);
  const evidence = messages
    .slice(-4)
    .map((m) => `${m.role === "user" ? "사용자" : "루나"}: ${m.content}`)
    .join("\n")
    .slice(0, 500);

  const lunaFirst =
    (await runDialogueTurn(admin, {
      mode: "first",
      content: draft,
      evidence
    })) || firstTurnFallback(draft);

  const created = await createCandidate(admin, {
    content: draft,
    evidence,
    category: "general",
    source: "chat",
    author_id: ownerId,
    assigned_to: ownerId,
    source_conversation_id: conversationId,
    thread: [makeTurn("luna", lunaFirst)],
    meta: { from_talk_teach: true }
  });

  if (!created) {
    return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: created.id,
    redirect: "/settings?tab=luna&luna=candidates&sub=pending"
  });
}
