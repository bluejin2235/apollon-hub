import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  listMatchingNotificationIds,
  loadMutedCategories,
  markNotificationsRead,
  parseNotificationFilter,
  resolveNotificationViewer
} from "@/lib/portal/hub-notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { filter?: unknown; include_muted?: unknown } = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as { filter?: unknown; include_muted?: unknown };
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filter = parseNotificationFilter(
    typeof body.filter === "string" ? body.filter : "all"
  );
  const includeMuted = body.include_muted === true || body.include_muted === "1";

  try {
    const viewer = await resolveNotificationViewer(admin, user);
    const { muted } = await loadMutedCategories(admin, viewer.userId);

    const unreadIds = await listMatchingNotificationIds(
      admin,
      viewer.userId,
      viewer.orFilter,
      {
        filter,
        includeMuted,
        mutedCategories: muted,
        unreadOnly: true
      }
    );

    if (unreadIds.length === 0) {
      return NextResponse.json({ ok: true, marked: 0, ids: [] });
    }

    await markNotificationsRead(admin, viewer.userId, unreadIds);

    return NextResponse.json({
      ok: true,
      marked: unreadIds.length,
      ids: unreadIds
    });
  } catch (err) {
    console.error("[notifications/read-all]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark all read" },
      { status: 500 }
    );
  }
}
