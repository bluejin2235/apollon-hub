import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  answerQuestion,
  listQuestions,
  type LunaQuestionStatus
} from "@/lib/luna-admin/questions";

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
  return NextResponse.json({ rows });
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
  return NextResponse.json({ row });
}
