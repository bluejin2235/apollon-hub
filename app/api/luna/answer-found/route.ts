import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import {
  getAnswerFoundForMessage,
  isFoundReason,
  saveAnswerFound
} from "@/lib/luna/answer-found";

export const runtime = "nodejs";

type PostBody = {
  message_id?: string;
  found?: boolean;
  reason?: string | null;
};

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messageId =
    request.nextUrl.searchParams.get("message_id")?.trim() ?? "";
  if (!messageId) {
    return NextResponse.json(
      { error: "message_id is required" },
      { status: 400 }
    );
  }

  const row = await getAnswerFoundForMessage(admin, messageId, user.id);
  return NextResponse.json({
    success: true,
    found: row?.found ?? null,
    reason: row?.reason ?? null
  });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageId =
    typeof body.message_id === "string" ? body.message_id.trim() : "";
  if (!messageId || typeof body.found !== "boolean") {
    return NextResponse.json(
      { error: "message_id and found (boolean) are required" },
      { status: 400 }
    );
  }

  const reason = isFoundReason(body.reason) ? body.reason : null;
  const result = await saveAnswerFound(admin, user, {
    messageId,
    found: body.found,
    reason
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    found: result.found,
    reason: result.reason
  });
}
