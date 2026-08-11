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

  try {
    const viewer = await resolveNotificationViewer(admin, user);

    const { data: rows, error: fetchError } = await admin
      .from("hub_notifications")
      .select("id")
      .or(viewer.orFilter);

    if (fetchError) {
      console.error("[notifications/read-all] fetch", fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, marked: 0 });
    }

    const { data: reads, error: readError } = await admin
      .from("hub_notification_reads")
      .select("notification_id")
      .eq("user_id", viewer.userId)
      .in("notification_id", ids);

    if (readError) {
      console.error("[notifications/read-all] reads", readError);
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    const readSet = new Set(
      (reads ?? []).map((r) => r.notification_id as string)
    );
    const unreadIds = ids.filter((id) => !readSet.has(id));
    if (unreadIds.length === 0) {
      return NextResponse.json({ ok: true, marked: 0 });
    }

    const now = new Date().toISOString();
    const payload = unreadIds.map((notification_id) => ({
      notification_id,
      user_id: viewer.userId,
      read_at: now
    }));

    const { error } = await admin
      .from("hub_notification_reads")
      .upsert(payload, { onConflict: "notification_id,user_id" });

    if (error) {
      console.error("[notifications/read-all] upsert", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, marked: unreadIds.length });
  } catch (err) {
    console.error("[notifications/read-all]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark all read" },
      { status: 500 }
    );
  }
}
