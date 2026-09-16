import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  answerQuestion,
  listQuestions,
  type LunaQuestionStatus
} from "@/lib/luna-admin/questions";
import { enrichQuestionPairs } from "@/lib/luna-admin/question-pairs";
import { resolveLunaQuestionAnswer } from "@/lib/luna/question-ask";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const statusParam = request.nextUrl.searchParams.get("status");
  const status: LunaQuestionStatus | undefined =
    statusParam === "pending" || statusParam === "answered" || statusParam === "skipped"
      ? statusParam
      : undefined;
  const mine = request.nextUrl.searchParams.get("mine") === "1";
  const rows = await listQuestions(gate.admin, {
    status: status ?? "pending",
    assignee: mine ? gate.user.id : undefined
  });
  const enriched = await enrichQuestionPairs(gate.admin, rows);
  return NextResponse.json({ rows: enriched });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: { id?: string; answer?: string; status?: "answered" | "skipped" } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const status = body.status === "skipped" ? "skipped" : "answered";
  if (status === "answered") {
    const resolved = await resolveLunaQuestionAnswer({
      admin: gate.admin,
      questionId: body.id,
      userId: gate.user.id,
      answer: body.answer ?? ""
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error ?? "update failed" },
        { status: resolved.status ?? 500 }
      );
    }
    return NextResponse.json({
      row: {
        id: resolved.row?.id,
        answer: body.answer ?? "",
        status: "answered"
      }
    });
  }
  const row = await answerQuestion(
    gate.admin,
    body.id,
    gate.user.id,
    body.answer ?? "skipped",
    "skipped"
  );
  if (!row) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ row });
}

