import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  createCandidate,
  hasOpenAssignedQuestion,
  makeTurn,
  parseJsonArray,
  parseJsonObject,
  type ScopeSuggestion
} from "@/lib/luna/candidates";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import {
  filterNewCaptureItems,
  reflectCandidateCap
} from "@/lib/luna/reflect-guard";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const REFLECT_LOCK_MS = 120_000;

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

확인이 필요한 질문은 별도로 최대 1건 (question). 본인(대화 상대)만 답할 수 있는 사실·선호·절차 확인에 한정.
없으면 question: null.

JSON만 응답. 다른 텍스트 금지. 없으면:
{ "candidates": [], "question": null }`;

const CAPTURE_USER_SUFFIX = `

위 규칙을 따르세요. JSON만 출력하세요.
형식:
{
  "candidates": [
    { "content": "지식 한 문장", "evidence": "근거 원문", "scope_suggestion": "org"|"personal", "category": "term"|"criterion"|"workflow"|"client"|"preference"|"general", "from_correction": true|false }
  ],
  "question": null | {
    "ask": "사람에게 물을 짧은 질문 (한 문장)",
    "content": "확인하려는 지식 초안 한 문장",
    "evidence": "근거 원문",
    "category": "term"|"criterion"|"workflow"|"client"|"preference"|"general"
  }
}
candidates 최대 3건. 사람의 정정("아니라", "그게 아니고" 등)이 있으면 최우선으로 올리세요.
question 은 확인이 꼭 필요할 때만 1건, 아니면 null. 본인만 답할 수 있는 내용만.
레거시로 배열만 줘도 candidates 로 처리합니다.`;

type ReflectBody = { conversation_id?: string };
type MessageRow = { role: string; content: string; created_at?: string };

type CaptureItem = {
  content: string;
  evidence: string | null;
  scope_suggestion: ScopeSuggestion | null;
  category: string;
  from_correction: boolean;
};

type CaptureQuestion = {
  ask: string;
  content: string;
  evidence: string | null;
  category: string;
};

type ConversationReflectRow = {
  id: string;
  last_reflected_at: string | null;
  last_reflected_message_count: number | null;
  reflect_lock_until: string | null;
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

function normalizeCaptureQuestion(raw: unknown): CaptureQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const ask = typeof row.ask === "string" ? row.ask.trim() : "";
  const content =
    typeof row.content === "string"
      ? row.content.trim()
      : typeof row.knowledge === "string"
        ? row.knowledge.trim()
        : "";
  if (!ask && !content) return null;
  const evidence =
    typeof row.evidence === "string" ? row.evidence.trim() || null : null;
  const categoryRaw =
    typeof row.category === "string" ? row.category.trim() : "general";
  if (categoryRaw === "identity") return null;
  return {
    ask: ask || (content ? `${content} — 맞아요?` : ""),
    content: content || ask,
    evidence,
    category: categoryRaw || "general"
  };
}

function parseCapturePayload(rawText: string): {
  items: CaptureItem[];
  question: CaptureQuestion | null;
} {
  const asObj = parseJsonObject(rawText);
  if (asObj) {
    const candidatesRaw = Array.isArray(asObj.candidates)
      ? asObj.candidates
      : Array.isArray(asObj.items)
        ? asObj.items
        : Array.isArray(asObj.learnings)
          ? asObj.learnings
          : null;
    return {
      items: normalizeCaptureItems(candidatesRaw),
      question: normalizeCaptureQuestion(asObj.question)
    };
  }
  const asArr = parseJsonArray(rawText);
  return {
    items: normalizeCaptureItems(asArr),
    question: null
  };
}

function buildTranscript(messages: MessageRow[]): string {
  return messages
    .map((m) => {
      const who = m.role === "assistant" ? "LUNA" : "User";
      const when = m.created_at ? ` (${m.created_at})` : "";
      return `${who}${when}: ${m.content}`;
    })
    .join("\n\n");
}

async function clearReflectLock(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  conversationId: string,
  userId: string
): Promise<void> {
  await admin
    .from("luna_conversations")
    .update({ reflect_lock_until: null })
    .eq("id", conversationId)
    .eq("user_id", userId);
}

async function finishReflectWatermark(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  conversationId: string,
  userId: string,
  messageCount: number
): Promise<void> {
  await admin
    .from("luna_conversations")
    .update({
      last_reflected_at: new Date().toISOString(),
      last_reflected_message_count: messageCount,
      reflect_lock_until: null
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
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

  const now = new Date();
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + REFLECT_LOCK_MS).toISOString();

  // 소유권 확인 + 만료된 락만 갱신(동시 실행 차단)
  const { data: locked, error: lockError } = await admin
    .from("luna_conversations")
    .update({ reflect_lock_until: lockUntil })
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .or(`reflect_lock_until.is.null,reflect_lock_until.lt."${nowIso}"`)
    .select(
      "id, last_reflected_at, last_reflected_message_count, reflect_lock_until"
    )
    .maybeSingle();

  if (lockError) {
    console.error("[luna/reflect] lock", lockError);
    return NextResponse.json({ error: lockError.message }, { status: 500 });
  }
  if (!locked) {
    const { data: existingConv } = await admin
      .from("luna_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existingConv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json({ saved: 0, skipped: "locked" });
  }

  const conv = locked as ConversationReflectRow;

  try {
    const { data: messagesData, error: messagesError } = await admin
      .from("luna_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("[luna/reflect] messages", messagesError);
      await clearReflectLock(admin, conversationId, user.id);
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    const messages = (messagesData ?? []) as MessageRow[];
    if (messages.length === 0) {
      await finishReflectWatermark(admin, conversationId, user.id, 0);
      return NextResponse.json({ saved: 0, skipped: "empty" });
    }

    const watermark = Math.max(0, conv.last_reflected_message_count ?? 0);
    if (messages.length <= watermark) {
      await finishReflectWatermark(admin, conversationId, user.id, messages.length);
      return NextResponse.json({ saved: 0, skipped: "no_new_messages" });
    }

    const { data: existingRows, error: existingError } = await admin
      .from("luna_learnings")
      .select("content")
      .eq("source_conversation_id", conversationId)
      .eq("source", "chat");

    if (existingError) {
      console.error("[luna/reflect] existing candidates", existingError);
      await clearReflectLock(admin, conversationId, user.id);
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existingContents = (existingRows ?? [])
      .map((r) => (typeof r.content === "string" ? r.content : ""))
      .filter(Boolean);
    const room = Math.max(0, reflectCandidateCap() - existingContents.length);

    if (room === 0) {
      // 상한 도달 — 워터마크만 전진, LLM 호출 없음
      await finishReflectWatermark(admin, conversationId, user.id, messages.length);
      return NextResponse.json({
        saved: 0,
        skipped: "cap",
        ids: [],
        correction_ids: [],
        question_id: null
      });
    }

    const newMessages = messages.slice(watermark);
    const transcript = buildTranscript(newMessages);
    const priorNote =
      watermark > 0
        ? `\n\n(참고: 이 대화의 앞부분 ${watermark}개 메시지는 이미 분석했습니다. 위는 그 이후 새 메시지만입니다. 이미 올린 지식과 중복되지 않게 하세요.)`
        : "";

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
            content: `다음 대화를 분석하세요.\n\n${transcript}${priorNote}${CAPTURE_USER_SUFFIX}`
          }
        ]
      });
      rawText =
        response.content.find((part) => part.type === "text")?.text?.trim() ?? "";
    } catch (err) {
      console.error("[luna/reflect] claude", err);
      await clearReflectLock(admin, conversationId, user.id);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Claude request failed" },
        { status: 500 }
      );
    }

    const { items, question: parsedQuestion } = parseCapturePayload(rawText);
    if (items.length === 0 && !parsedQuestion) {
      await finishReflectWatermark(admin, conversationId, user.id, messages.length);
      if (!parseJsonArray(rawText) && !parseJsonObject(rawText)) {
        console.warn("[luna/reflect] JSON parse failed, skipping insert");
        return NextResponse.json({ saved: 0, parse_error: true });
      }
      return NextResponse.json({ saved: 0 });
    }

    const toCreate = filterNewCaptureItems(items, existingContents, room);

    let saved = 0;
    const ids: string[] = [];
    const correctionIds: string[] = [];
    for (const item of toCreate) {
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
        existingContents.push(created.content);
      }
    }

    let questionId: string | null = null;
    if (parsedQuestion) {
      const alreadyOpen = await hasOpenAssignedQuestion(admin, user.id);
      if (!alreadyOpen) {
        const ask = parsedQuestion.ask.trim();
        const createdQ = await createCandidate(admin, {
          content: parsedQuestion.content,
          evidence: parsedQuestion.evidence,
          category: parsedQuestion.category,
          source: "question",
          author_id: user.id,
          assigned_to: user.id,
          source_conversation_id: conversationId,
          thread: ask ? [makeTurn("luna", ask)] : [],
          meta: { popup: true }
        });
        if (createdQ) {
          questionId = createdQ.id;
          saved += 1;
          ids.push(createdQ.id);
        }
      }
    }

    await finishReflectWatermark(admin, conversationId, user.id, messages.length);

    // 지식후보 생성 즉시 알림은 보내지 않음 — 아침 요약(/api/cron/luna-morning)에만 포함

    return NextResponse.json({
      saved,
      ids,
      correction_ids: correctionIds,
      question_id: questionId,
      skipped_dupes: Math.max(0, items.length - toCreate.length)
    });
  } catch (err) {
    console.error("[luna/reflect] unexpected", err);
    await clearReflectLock(admin, conversationId, user.id);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reflect failed" },
      { status: 500 }
    );
  }
}
