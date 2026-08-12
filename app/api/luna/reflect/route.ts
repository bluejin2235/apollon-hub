import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  createCandidate,
  parseJsonArray,
  type ScopeSuggestion
} from "@/lib/luna/candidates";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import { lunaNotify } from "@/lib/luna/notify";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-sonnet-4-6";

const REFLECT_SYSTEM_PROMPT_FALLBACK = `방금 대화에서 배울 것이 있었는지 판정하고, 있으면 지식 후보를 만든다.

후보로 올리는 것:
① 사람의 정정 — 내 답을 고쳐준 것 ("아니라 ~야", "그게 아니고") : 최우선
② 새 사실·용어·절차 — 아폴론의 일하는 방식, 프로젝트 정보, 용어 정의
③ 반복 패턴 — 여러 사람이 비슷하게 묻는 것 (내가 못 잡고 있는 지식)

올리지 않는 것:
- 잡담, 감정 표현, 일회성 맥락
- 이미 확정 지식으로 아는 것
- 개인의 사생활
- 확신이 서지 않는 애매한 추측

후보 형식: 지식 한 문장 + 근거 원문(누가·언제 말했는지) + 조직/개인 구분 제안.
하루에 같은 대화에서 후보는 최대 3건. 양보다 정확함.

JSON 배열만 응답. 다른 텍스트 금지. 없으면 []:
[{ "content": "지식 한 문장", "evidence": "근거 원문", "scope_suggestion": "org"|"personal", "category": "term"|"criterion"|"workflow"|"client"|"preference"|"general" }]`;

const CAPTURE_USER_SUFFIX = `

위 규칙을 따르세요. JSON 배열만 출력하세요. 파싱 가능한 JSON이 아니면 빈 배열 [].
최대 3건. 사람의 정정("아니라", "그게 아니고" 등)이 있으면 최우선으로 올리세요.
각 항목에 from_correction: true|false 를 포함하세요 (직전 사용자 정정에 근거하면 true).`;

type ReflectBody = { conversation_id?: string };
type MessageRow = { role: string; content: string; created_at?: string };

type CaptureItem = {
  content: string;
  evidence: string | null;
  scope_suggestion: ScopeSuggestion | null;
  category: string;
  from_correction: boolean;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function normalizeCaptureItems(raw: unknown[] | null): CaptureItem[] {
  if (!raw) return [];
  const out: CaptureItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!content) continue;
    const categoryRaw =
      typeof row.category === "string" ? row.category.trim() : "general";
    if (categoryRaw === "identity") continue;
    const scopeRaw =
      typeof row.scope_suggestion === "string"
        ? row.scope_suggestion.trim()
        : "";
    const scope_suggestion: ScopeSuggestion | null =
      scopeRaw === "org" || scopeRaw === "personal" ? scopeRaw : null;
    const evidence =
      typeof row.evidence === "string" ? row.evidence.trim() || null : null;
    const evidenceHint = `${evidence ?? ""} ${content}`.toLowerCase();
    const fromCorrection =
      row.from_correction === true ||
      /아니라|그게 아니고|그게 아니라|틀렸|잘못된/.test(evidenceHint);
    out.push({
      content,
      evidence,
      scope_suggestion,
      category: categoryRaw || "general",
      from_correction: fromCorrection
    });
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

  const { data: messagesData, error: messagesError } = await admin
    .from("luna_messages")
    .select("role, content, created_at")
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
    .map((m) => {
      const who = m.role === "assistant" ? "LUNA" : "User";
      const when = m.created_at ? ` (${m.created_at})` : "";
      return `${who}${when}: ${m.content}`;
    })
    .join("\n\n");

  const reflectPrompt =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.capture)).trim() ||
    REFLECT_SYSTEM_PROMPT_FALLBACK;

  let rawText = "";
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: reflectPrompt,
      messages: [
        {
          role: "user",
          content: `다음 대화를 분석하세요.\n\n${transcript}${CAPTURE_USER_SUFFIX}`
        }
      ]
    });
    rawText =
      response.content.find((part) => part.type === "text")?.text?.trim() ?? "";
  } catch (err) {
    console.error("[luna/reflect] claude", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Claude request failed" },
      { status: 500 }
    );
  }

  const parsed = parseJsonArray(rawText);
  if (!parsed) {
    // 파싱 실패 시 아무것도 생성하지 않음
    console.warn("[luna/reflect] JSON parse failed, skipping insert");
    return NextResponse.json({ saved: 0, parse_error: true });
  }

  const items = normalizeCaptureItems(parsed);
  if (items.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  let saved = 0;
  const ids: string[] = [];
  const correctionIds: string[] = [];
  for (const item of items) {
    const created = await createCandidate(admin, {
      content: item.content,
      evidence: item.evidence,
      scope_suggestion: item.scope_suggestion,
      category: item.category,
      source: "chat",
      author_id: user.id,
      assigned_to: user.id,
      source_conversation_id: conversationId,
      thread: [],
      meta: item.from_correction ? { from_correction: true } : {}
    });
    if (created) {
      saved += 1;
      ids.push(created.id);
      if (item.from_correction) correctionIds.push(created.id);
    }
  }

  if (saved > 0) {
    await lunaNotify(
      admin,
      "reflect",
      "지식 후보",
      `루나가 후보 ${saved}건을 올렸어요`,
      {
        level: "success",
        meta: { saved, conversation_id: conversationId, ids, correctionIds }
      }
    );
  }

  return NextResponse.json({
    saved,
    ids,
    correction_ids: correctionIds
  });
}
