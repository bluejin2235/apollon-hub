import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { resolveNotificationViewer } from "@/lib/portal/hub-notifications";

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

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const viewer = await resolveNotificationViewer(admin, user);

    const { data: row, error: fetchError } = await admin
      .from("hub_notifications")
      .select("id, scope, target_user_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      console.error("[notifications/read] fetch", fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const scope = row.scope as string;
    const targetUserId = (row.target_user_id as string | null) ?? null;
    const visible =
      scope === "all" ||
      (scope === "admin" && viewer.isAdmin) ||
      (scope === "user" && targetUserId === viewer.userId);
    if (!visible) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const { error } = await admin.from("hub_notification_reads").upsert(
      {
        notification_id: id,
        user_id: viewer.userId,
        read_at: new Date().toISOString()
      },
      { onConflict: "notification_id,user_id" }
    );

    if (error) {
      console.error("[notifications/read] upsert", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[notifications/read]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark read" },
      { status: 500 }
    );
  }
}
