import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  listOpenQuestions,
  openQuestionWeekDelta,
  resolveOpenQuestion
} from "@/lib/luna/open-questions";

export const runtime = "nodejs";

/** GET /api/luna/open-questions — 블루진 전용 */
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [items, week] = await Promise.all([
    listOpenQuestions(admin, { limit: 40 }),
    openQuestionWeekDelta(admin)
  ]);
  return NextResponse.json({ items, ...week });
}

/** PATCH — resolve */
export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id || body.action !== "resolve") {
    return NextResponse.json({ error: "id and action=resolve required" }, { status: 400 });
  }
  const ok = await resolveOpenQuestion(admin, id);
  return NextResponse.json({ ok });
}
