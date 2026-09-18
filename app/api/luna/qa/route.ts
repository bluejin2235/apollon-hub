import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  answerQaChoice,
  getOpenQaSession,
  restartQaSession,
  startQaSession
} from "@/lib/luna/qa-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const session = await getOpenQaSession(gate.admin, gate.user.id);
  return NextResponse.json({ session });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: {
    action?: string;
    option_id?: string;
    transcript?: string;
    session_id?: string;
  } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "start" || !body.action) {
      const session = await startQaSession(gate.admin, gate.user.id);
      return NextResponse.json({ session });
    }
    if (body.action === "restart") {
      const session = await restartQaSession(gate.admin, gate.user.id);
      return NextResponse.json({ session });
    }
    if (body.action === "answer") {
      if (!body.session_id || !body.option_id) {
        return NextResponse.json(
          { error: "session_id and option_id required" },
          { status: 400 }
        );
      }
      const session = await answerQaChoice({
        admin: gate.admin,
        userId: gate.user.id,
        sessionId: body.session_id,
        optionId: body.option_id,
        transcript: body.transcript
      });
      return NextResponse.json({ session });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[luna/qa]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "qa failed" },
      { status: 500 }
    );
  }
}
