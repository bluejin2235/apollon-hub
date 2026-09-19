import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { applyMemoryAskAnswer } from "@/lib/luna/memory-ask";

export const runtime = "nodejs";

type Body = {
  message_id?: string;
  answer?: string;
};

/** POST /api/luna/memory-ask — 한 줄 묻기 응답 */
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageId =
    typeof body.message_id === "string" ? body.message_id.trim() : "";
  const answer =
    body.answer === "accept" || body.answer === "reject" ? body.answer : null;
  if (!messageId || !answer) {
    return NextResponse.json(
      { error: "message_id and answer (accept|reject) required" },
      { status: 400 }
    );
  }

  const result = await applyMemoryAskAnswer(admin, {
    userId: user.id,
    messageId,
    answer
  });
  if (!result.ok) {
    const status =
      result.error === "forbidden"
        ? 403
        : result.error === "not_found"
          ? 404
          : 400;
    return NextResponse.json({ error: result.error ?? "failed" }, { status });
  }
  return NextResponse.json({ ok: true });
}
