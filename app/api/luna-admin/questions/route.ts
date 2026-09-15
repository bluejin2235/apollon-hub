import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { reviewSameLinks } from "@/lib/luna-admin/links";
import {
  answerQuestion,
  listQuestions,
  type LunaQuestionStatus
} from "@/lib/luna-admin/questions";
import { enrichQuestionPairs } from "@/lib/luna-admin/question-pairs";

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
  const row = await answerQuestion(
    gate.admin,
    body.id,
    gate.user.id,
    body.answer ?? (status === "skipped" ? "skipped" : ""),
    status
  );
  if (!row) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  const answer = body.answer ?? "";
  // 지식후보에서 답해도 luna_links 를 같이 닫는다 (confirm/reject 가 질문도 다시 닫지만 이미 answered).
  if (
    row.link_id &&
    (answer === "같아요" ||
      answer === "달라요" ||
      answer === "같다" ||
      answer === "다르다")
  ) {
    try {
      await reviewSameLinks(gate.admin, gate.user.id, {
        action:
          answer === "같아요" || answer === "같다" ? "confirm" : "reject",
        ids: [row.link_id]
      });
    } catch {
      /* 링크 갱신은 질문에 덧붙이는 일 */
    }
  }
  return NextResponse.json({ row });
}

