import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  listNotificationPrefs,
  resolveNotificationViewer,
  upsertNotificationPref
} from "@/lib/portal/hub-notifications";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
    const { items, missingTable } = await listNotificationPrefs(
      admin,
      viewer.userId,
      viewer.orFilter
    );
    return NextResponse.json({ items, missing_table: missingTable });
  } catch (err) {
    console.error("[notifications/prefs] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load prefs" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { category?: unknown; enabled?: unknown };
  try {
    body = (await request.json()) as { category?: unknown; enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const category =
    typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  const enabled = body.enabled !== false;

  try {
    const viewer = await resolveNotificationViewer(admin, user);
    const result = await upsertNotificationPref(
      admin,
      viewer.userId,
      category,
      enabled
    );
    if (result.missingTable) {
      return NextResponse.json(
        {
          ok: false,
          missing_table: true,
          error: "hub_notification_prefs 테이블이 아직 없습니다"
        },
        { status: 503 }
      );
    }
    return NextResponse.json({
      ok: true,
      category,
      enabled,
      missing_table: false
    });
  } catch (err) {
    console.error("[notifications/prefs] PUT", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save pref" },
      { status: 500 }
    );
  }
}
