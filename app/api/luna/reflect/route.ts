import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { getPrompt } from "@/lib/luna/prompts";
import { lunaNotify } from "@/lib/luna/notify";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-sonnet-4-6";

const REFLECT_SYSTEM_PROMPT_FALLBACK = `당신은 LUNA입니다. 아폴론이머시브웍스의 AI입니다.
방금 끝난 대화를 분석해서 아폴론에 대해 새로 알게 된 것을 정리하세요.
아래 형식의 JSON 배열로만 응답하세요. 다른 텍스트 없이 JSON만:
[{ "category": "카테고리", "content": "배운 내용" }]
카테고리: preference(선호방향), client(클라이언트성향), project(프로젝트패턴), style(크리에이티브스타일), general(기타)
새로 배운 것이 없으면 빈 배열 [] 반환. 최대 3개까지만.`;

const ALLOWED_CATEGORIES = new Set([
  "preference",
  "client",
  "project",
  "style",
  "general"
]);

type ReflectBody = { conversation_id?: string };
type MessageRow = { role: string; content: string };
type LearningItem = { category: string; content: string };

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function extractJsonArray(text: string): LearningItem[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as LearningItem[];
  } catch {
    /* fall through */
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1].trim()) as unknown;
      if (Array.isArray(parsed)) return parsed as LearningItem[];
    } catch {
      /* fall through */
    }
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) return parsed as LearningItem[];
    } catch {
      /* fall through */
    }
  }

  return [];
}

function normalizeLearnings(raw: LearningItem[]): LearningItem[] {
  const out: LearningItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const categoryRaw = typeof item.category === "string" ? item.category.trim() : "";
    if (categoryRaw === "identity") continue;
    const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : "general";
    if (!content) continue;
    out.push({ category, content });
    if (out.length >= 3) break;
  }
  return out;
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

  let body: ReflectBody;
  try {
    body = (await request.json()) as ReflectBody;
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
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/reflect] conversation", convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // 1) 메시지 전체 조회
  const { data: messagesData, error: messagesError } = await admin
    .from("luna_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("[luna/reflect] messages", messagesError);
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const messages = (messagesData ?? []) as MessageRow[];
  if (messages.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "LUNA" : "User"}: ${m.content}`)
    .join("\n\n");

  const reflectPrompt =
    (await getPrompt(admin, "knowledge.extract")).trim() || REFLECT_SYSTEM_PROMPT_FALLBACK;

  // 2) Claude (비스트리밍)
  let rawText = "";
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: reflectPrompt,
      messages: [
        {
          role: "user",
          content: `다음 대화를 분석하세요.\n\n${transcript}`
        }
      ]
    });
    rawText = response.content.find((part) => part.type === "text")?.text?.trim() ?? "";
  } catch (err) {
    console.error("[luna/reflect] claude", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Claude request failed" },
      { status: 500 }
    );
  }

  // 3) JSON 파싱 후 INSERT
  const learnings = normalizeLearnings(extractJsonArray(rawText));
  if (learnings.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  const rows = learnings.map((l) => ({
    category: l.category,
    content: l.content,
    source_conversation_id: conversationId,
    status: "candidate" as const,
    author_id: user.id
  }));

  const { error: insertError } = await admin.from("luna_learnings").insert(rows);
  if (insertError) {
    console.error("[luna/reflect] insert", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await lunaNotify(
    admin,
    "reflect",
    "루나가 배움",
    `루나가 ${rows.length}건 배움`,
    { level: "success", meta: { saved: rows.length, conversation_id: conversationId } }
  );

  // 4)
  return NextResponse.json({ saved: rows.length });
}
