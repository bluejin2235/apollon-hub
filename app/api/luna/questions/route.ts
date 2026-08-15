import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import { getPrompt } from "@/lib/luna/prompts";

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

type QuestionRow = {
  id: string;
  question: string;
  context: string | null;
  options: unknown;
  category: string | null;
  source: string | null;
  status: string;
  created_at: string;
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

function parseOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const opts = raw
    .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    .map((o) => o.trim());
  return opts.length > 0 ? opts : null;
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

  const { data, error } = await admin
    .from("luna_questions")
    .select(
      "id, question, context, options, category, source, status, created_at"
    )
    .eq("status", "pending")
    .or(`target_user_id.eq.${user.id},target_user_id.is.null`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[luna/questions] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ question: null });
  }

  const row = data as QuestionRow;
  return NextResponse.json({
    question: {
      id: row.id,
      question: row.question,
      context: row.context,
      options: parseOptions(row.options),
      category: row.category,
      source: row.source,
      created_at: row.created_at
    }
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

  let body: { question_id?: string; answer?: string };
  try {
    body = (await request.json()) as { question_id?: string; answer?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const questionId =
    typeof body.question_id === "string" ? body.question_id.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!questionId || !answer) {
    return NextResponse.json(
      { error: "question_id and answer are required" },
      { status: 400 }
    );
  }

  const { data: qRow, error: qErr } = await admin
    .from("luna_questions")
    .select(
      "id, question, context, category, status, target_user_id"
    )
    .eq("id", questionId)
    .maybeSingle();

  if (qErr) {
    console.error("[luna/questions] fetch", qErr);
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }
  if (!qRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (qRow.status !== "pending") {
    return NextResponse.json({ error: "Question is not pending" }, { status: 400 });
  }
  if (
    qRow.target_user_id &&
    qRow.target_user_id !== user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const systemPrompt =
    (await getPrompt(admin, "knowledge.direct")).trim() || DIRECT_FALLBACK;

  const userPayload = [
    `루나 질문:\n${qRow.question}`,
    qRow.context ? `맥락:\n${qRow.context}` : null,
    `사용자 답변:\n${answer}`
  ]
    .filter(Boolean)
    .join("\n\n");

  let content = answer;
  let category = normalizeCategory(qRow.category);
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
      category = normalizeCategory(parsed.category ?? qRow.category);
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

  const answeredAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("luna_questions")
    .update({
      status: "answered",
      answer,
      answered_by: user.id,
      answered_at: answeredAt,
      learning_id: learning.id
    })
    .eq("id", questionId)
    .eq("status", "pending");

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
