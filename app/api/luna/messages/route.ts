import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isFeedbackReason } from "@/lib/luna/feedback";
import { saveLunaMessageFeedback } from "@/lib/luna/message-feedback";

export const runtime = "nodejs";

type PatchBody = {
  message_id?: string;
  feedback?: string | null;
  reason?: string | null;
};

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
  const rawFeedback = body.feedback;
  const feedback =
    rawFeedback === "good" || rawFeedback === "bad"
      ? rawFeedback
      : rawFeedback === null || rawFeedback === ""
        ? null
        : undefined;
  if (!messageId || feedback === undefined) {
    return NextResponse.json(
      { error: "message_id and feedback ('good'|'bad'|null) are required" },
      { status: 400 }
    );
  }

  const reason = isFeedbackReason(body.reason) ? body.reason : null;
  const result = await saveLunaMessageFeedback(admin, user, {
    messageId,
    feedback,
    reason
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    feedback: result.feedback,
    reason: result.reason
  });
}
