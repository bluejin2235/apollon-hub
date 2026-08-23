import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  markNotificationsRead,
  markNotificationsUnread,
  resolveNotificationViewer
} from "@/lib/portal/hub-notifications";

export const runtime = "nodejs";

function parseIds(body: { id?: unknown; ids?: unknown }): string[] {
  if (Array.isArray(body.ids)) {
    return body.ids
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof body.id === "string") {
    const id = body.id.trim();
    return id ? [id] : [];
  }
  return [];
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { id?: unknown; ids?: unknown; read?: unknown };
  try {
    body = (await request.json()) as {
      id?: unknown;
      ids?: unknown;
      read?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = parseIds(body);
  if (ids.length === 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const read = body.read !== false;

  try {
    const viewer = await resolveNotificationViewer(admin, user);

    const { data: rows, error: fetchError } = await admin
      .from("hub_notifications")
      .select("id, scope, target_user_id")
      .in("id", ids);

    if (fetchError) {
      console.error("[notifications/read] fetch", fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const visibleIds = (rows ?? [])
      .filter((row) => {
        const scope = row.scope as string;
        const targetUserId = (row.target_user_id as string | null) ?? null;
        return (
          scope === "all" ||
          (scope === "admin" && viewer.isAdmin) ||
          (scope === "user" && targetUserId === viewer.userId)
        );
      })
      .map((row) => row.id as string);

    if (visibleIds.length === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    if (read) {
      await markNotificationsRead(admin, viewer.userId, visibleIds);
    } else {
      await markNotificationsUnread(admin, viewer.userId, visibleIds);
    }

    return NextResponse.json({
      ok: true,
      ids: visibleIds,
      read
    });
  } catch (err) {
    console.error("[notifications/read]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark read" },
      { status: 500 }
    );
  }
}
