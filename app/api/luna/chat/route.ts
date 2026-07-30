import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-sonnet-4-6";

const BASE_SYSTEM_PROMPT = `당신은 루나(Luna)입니다. 아폴론이머시브웍스의 AI입니다.
아폴론이머시브웍스는 미디어 아키텍처 전문 스튜디오로 'We Make Beloved Digital Landmarks'가 미션입니다.
미디어 설치, 공간 경험 디자인, 인터랙티브 콘텐츠를 전문으로 합니다.
답변할 때는 아폴론의 관점에서 생각하세요.`;

type ChatRequestBody = {
  conversation_id?: string;
  message?: string;
  engine?: string;
};

type LearningRow = { content: string; category: string };
type MessageRow = { role: string; content: string };

/** UI 엔진 선택 → 실제 호출 엔진명 (Phase A: Claude만 사용) */
function resolveEngine(requested: string | undefined): string {
  const key = (requested ?? "auto").trim().toLowerCase();
  if (key === "claude" || key === "gpt" || key === "gemini" || key === "auto") {
    return "claude";
  }
  return "claude";
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function buildSystemPrompt(learnings: LearningRow[]): string {
  if (learnings.length === 0) return BASE_SYSTEM_PROMPT;

  const learningBlock = learnings
    .map((l, i) => `${i + 1}. [${l.category}] ${l.content}`)
    .join("\n");

  return `${BASE_SYSTEM_PROMPT}

## 학습된 지식
${learningBlock}`;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: "Claude API key is not configured" }, { status: 500 });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!conversationId || !message) {
    return NextResponse.json(
      { error: "conversation_id and message are required" },
      { status: 400 }
    );
  }

  const usedEngine = resolveEngine(body.engine);

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id, user_id, engine")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/chat] conversation", convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // 1) learnings 최신 10개
  const { data: learningsData, error: learningsError } = await admin
    .from("luna_learnings")
    .select("content, category")
    .order("created_at", { ascending: false })
    .limit(10);

  if (learningsError) {
    console.error("[luna/chat] learnings", learningsError);
    return NextResponse.json({ error: learningsError.message }, { status: 500 });
  }

  const learnings = (learningsData ?? []) as LearningRow[];

  // 2) 최근 메시지 20개
  const { data: recentData, error: recentError } = await admin
    .from("luna_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recentError) {
    console.error("[luna/chat] messages", recentError);
    return NextResponse.json({ error: recentError.message }, { status: 500 });
  }

  const recent = ((recentData ?? []) as MessageRow[]).reverse();
  const historyMessages: Anthropic.MessageParam[] = recent
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

  historyMessages.push({ role: "user", content: message });

  // 3) 시스템 프롬프트
  const systemPrompt = buildSystemPrompt(learnings);

  const encoder = new TextEncoder();
  let assistantText = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 4) Claude 스트리밍
        const anthropicStream = client.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: historyMessages
        });

        anthropicStream.on("text", (textDelta) => {
          assistantText += textDelta;
          controller.enqueue(encoder.encode(textDelta));
        });

        await anthropicStream.finalMessage();

        // 5) user + assistant INSERT
        const { error: insertError } = await admin.from("luna_messages").insert([
          {
            conversation_id: conversationId,
            role: "user",
            content: message,
            engine: usedEngine
          },
          {
            conversation_id: conversationId,
            role: "assistant",
            content: assistantText,
            engine: usedEngine
          }
        ]);

        if (insertError) {
          console.error("[luna/chat] insert messages", insertError);
        }

        // 6) conversation updated_at 갱신
        const { error: updateError } = await admin
          .from("luna_conversations")
          .update({
            updated_at: new Date().toISOString(),
            engine: typeof body.engine === "string" ? body.engine : conversation.engine
          })
          .eq("id", conversationId)
          .eq("user_id", user.id);

        if (updateError) {
          console.error("[luna/chat] update conversation", updateError);
        }

        controller.close();
      } catch (err) {
        console.error("[luna/chat] stream", err);
        const msg = err instanceof Error ? err.message : "Stream failed";
        try {
          controller.enqueue(encoder.encode(`\n\n[오류] ${msg}`));
        } catch {
          /* already closed */
        }
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Luna-Engine": usedEngine
    }
  });
}
