import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  answerQaChoice,
  getOpenQaSession,
  restartQaSession,
  startQaSession
} from "@/lib/luna/qa-session";

export const runtime = "nodejs";

async function requireLunaQa(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const isSuperAdmin = await isSuperAdminUser(admin, user);
  return { user, admin, isSuperAdmin };
}

export async function GET(request: NextRequest) {
  const gate = await requireLunaQa(request);
  if ("error" in gate) return gate.error;
  const session = await getOpenQaSession(gate.admin, gate.user.id);
  return NextResponse.json({ session });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaQa(request);
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
  const roleOpts = { isSuperAdmin: gate.isSuperAdmin };
  try {
    if (body.action === "start" || !body.action) {
      const session = await startQaSession(gate.admin, gate.user.id, roleOpts);
      return NextResponse.json({ session });
    }
    if (body.action === "restart") {
      const session = await restartQaSession(gate.admin, gate.user.id, roleOpts);
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
