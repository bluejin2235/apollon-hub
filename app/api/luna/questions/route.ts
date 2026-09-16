import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import { getPrompt } from "@/lib/luna/prompts";
import {
  conversationHaystack,
  isConfirmSameAnswer,
  isRejectSameAnswer,
  listAskQuestions,
  resolveLunaQuestionAnswer,
  snoozeQuestionForUser
} from "@/lib/luna/question-ask";

export const runtime = "nodejs";

const DIRECT_FALLBACK = `당신은 팀 지식을 정리하는 편집자입니다.
루나의 질문과 사용자의 답변을 보고 지식 한 문장으로 다듬으세요.
JSON만 응답:
{
  "status": "ok"|"duplicate"|"conflict",
  "message": "사용자에게 보여줄 한 줄",
  "content": "다듬은 지식 문장",
  "category": "term"|"criterion"|"workflow"|"client"|"preference",
  "removed": ""
}`;

const ALLOWED_CATEGORIES = new Set([
  "term",
  "criterion",
  "workflow",
  "client",
  "preference"
]);

const CATEGORY_ALIASES: Record<string, string> = {
  term: "term",
  용어: "term",
  criterion: "criterion",
  판단기준: "criterion",
  workflow: "workflow",
  업무방식: "workflow",
  style: "workflow",
  client: "client",
  클라이언트: "client",
  preference: "preference",
  선호: "preference",
  general: "term",
  project: "workflow"
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

function normalizeCategory(raw: unknown): string {
  if (typeof raw !== "string") return "term";
  const key = raw.trim();
  return CATEGORY_ALIASES[key] ?? CATEGORY_ALIASES[key.toLowerCase()] ?? "term";
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const list = request.nextUrl.searchParams.get("list") === "1";
  const conversationId =
    request.nextUrl.searchParams.get("conversation_id")?.trim() || "";
  const topic = request.nextUrl.searchParams.get("topic")?.trim() || "";

  if (conversationId || topic) {
    const haystack =
      topic ||
      (conversationId
        ? await conversationHaystack(admin, conversationId, user.id)
        : "");
    const result = await listAskQuestions(admin, user.id, {
      limit: 1,
      haystack,
      retarget: false
    });
    return NextResponse.json({
      question: result.questions[0] ?? null,
      count: result.count,
      muted: result.muted,
      daily_left: result.daily_left
    });
  }

  const result = await listAskQuestions(admin, user.id, {
    limit: 1,
    retarget: list
  });
  if (list) {
    return NextResponse.json({
      questions: result.questions,
      count: result.count,
      muted: result.muted,
      daily_left: result.daily_left
    });
  }
  return NextResponse.json({
    question: result.questions[0] ?? null,
    count: result.count,
    muted: result.muted,
    daily_left: result.daily_left
  });
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
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { question_id?: string; answer?: string; action?: string };
  try {
    body = (await request.json()) as {
      question_id?: string;
      answer?: string;
      action?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const questionId =
    typeof body.question_id === "string" ? body.question_id.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!questionId) {
    return NextResponse.json({ error: "question_id is required" }, { status: 400 });
  }

  if (action === "later") {
    const later = await snoozeQuestionForUser(admin, questionId, user.id);
    if (!later.ok) {
      const status =
        later.error === "Not found"
          ? 404
          : later.error === "Forbidden"
            ? 403
            : 400;
      return NextResponse.json({ error: later.error }, { status });
    }
    return NextResponse.json({ ok: true, action: "later" });
  }

  if (!answer) {
    return NextResponse.json(
      { error: "question_id and answer are required" },
      { status: 400 }
    );
  }

  const resolved = await resolveLunaQuestionAnswer({
    admin,
    questionId,
    userId: user.id,
    answer
  });
  if (!resolved.ok || !resolved.row) {
    return NextResponse.json(
      { error: resolved.error ?? "update failed" },
      { status: resolved.status ?? 500 }
    );
  }

  const judgment =
    isConfirmSameAnswer(answer) ||
    isRejectSameAnswer(answer) ||
    answer === "모르겠어요";
  if (judgment) {
    const message = isConfirmSameAnswer(answer)
      ? "같은 것으로 기억할게요."
      : isRejectSameAnswer(answer)
        ? "다른 것으로 기억할게요."
        : "표시해 두었어요.";
    return NextResponse.json({
      ok: true,
      message,
      content: resolved.row.question
    });
  }

  const { data: qRow } = await admin
    .from("luna_questions")
    .select("id, question, context, category")
    .eq("id", questionId)
    .maybeSingle();

  const systemPrompt =
    (await getPrompt(admin, "knowledge.direct")).trim() || DIRECT_FALLBACK;

  const userPayload = [
    `루나 질문:\n${resolved.row.question}`,
    Object.keys(resolved.row.context).length > 0
      ? `맥락:\n${JSON.stringify(resolved.row.context)}`
      : null,
    `사용자 답변:\n${answer}`
  ]
    .filter(Boolean)
    .join("\n\n");

  let content = answer;
  let category = normalizeCategory(qRow?.category);
  let message = "고맙습니다. 이제 이렇게 찾을게요.";

  try {
    const res = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "learn_capture",
      system: systemPrompt,
      user: userPayload,
      maxTokens: 1024
    });
    const parsed = parseJsonObject(res.text.trim());
    if (parsed) {
      if (typeof parsed.content === "string" && parsed.content.trim()) {
        content = parsed.content.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        message = parsed.message.trim();
      }
      category = normalizeCategory(parsed.category ?? qRow?.category);
    }
  } catch (err) {
    console.error("[luna/questions] model", err);
  }

  if (!ALLOWED_CATEGORIES.has(category)) category = "term";

  const { data: learning, error: insertErr } = await admin
    .from("luna_learnings")
    .insert({
      content,
      category,
      status: "active",
      origin: "direct",
      author_id: user.id,
      confidence: 3,
      importance: 4,
      raw_input: answer,
      use_count: 0
    })
    .select("id, content")
    .single();

  if (insertErr) {
    console.error("[luna/questions] insert learning", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { error: updateErr } = await admin
    .from("luna_questions")
    .update({ learning_id: learning.id })
    .eq("id", questionId);

  if (updateErr) {
    console.error("[luna/questions] update", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message,
    content: learning.content as string,
    learning_id: learning.id as string,
    category
  });
}
