import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  countUnreadNotifications,
  decodeNotificationCursor,
  encodeNotificationCursor,
  resolveNotificationViewer,
  type HubNotificationItem
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

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(50, Math.max(1, Math.round(limitRaw)))
    : 20;
  const cursorParam = request.nextUrl.searchParams.get("cursor")?.trim() || "";

  try {
    const viewer = await resolveNotificationViewer(admin, user);

    let query = admin
      .from("hub_notifications")
      .select(
        "id, category, title, body, link, level, scope, created_at"
      )
      .or(viewer.orFilter)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (cursorParam) {
      const cursor = decodeNotificationCursor(cursorParam);
      if (!cursor) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error("[notifications] GET", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ids = page.map((r) => r.id as string);

    const readSet = new Set<string>();
    if (ids.length > 0) {
      const { data: reads, error: readError } = await admin
        .from("hub_notification_reads")
        .select("notification_id")
        .eq("user_id", viewer.userId)
        .in("notification_id", ids);
      if (readError) {
        console.error("[notifications] GET reads", readError);
        return NextResponse.json({ error: readError.message }, { status: 500 });
      }
      for (const r of reads ?? []) {
        readSet.add(r.notification_id as string);
      }
    }

    const items: HubNotificationItem[] = page.map((r) => ({
      id: r.id as string,
      category: r.category as string,
      title: r.title as string,
      body: (r.body as string | null) ?? null,
      link: (r.link as string | null) ?? null,
      level: r.level as string,
      scope: r.scope as string,
      created_at: (r.created_at as string) ?? new Date(0).toISOString(),
      read: readSet.has(r.id as string)
    }));

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeNotificationCursor(last.created_at, last.id)
        : null;

    const unread_count = await countUnreadNotifications(
      admin,
      viewer.userId,
      viewer.orFilter
    );

    return NextResponse.json({
      items,
      unread_count,
      next_cursor: nextCursor
    });
  } catch (err) {
    console.error("[notifications] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load notifications" },
      { status: 500 }
    );
  }
}
