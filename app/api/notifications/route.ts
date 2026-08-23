import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  countUnreadNotifications,
  decodeNotificationCursor,
  listHubNotifications,
  loadMutedCategories,
  notificationFilterCounts,
  parseNotificationFilter,
  resolveNotificationViewer
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
  const filter = parseNotificationFilter(
    request.nextUrl.searchParams.get("filter")
  );
  const includeMuted =
    request.nextUrl.searchParams.get("include_muted") === "1" ||
    request.nextUrl.searchParams.get("include_muted") === "true";
  const withCounts =
    request.nextUrl.searchParams.get("with_counts") === "1" ||
    request.nextUrl.searchParams.get("with_counts") === "true";

  try {
    const viewer = await resolveNotificationViewer(admin, user);
    const { muted } = await loadMutedCategories(admin, viewer.userId);

    let cursor: { createdAt: string; id: string } | null = null;
    if (cursorParam) {
      cursor = decodeNotificationCursor(cursorParam);
      if (!cursor) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    const { items, nextCursor } = await listHubNotifications(
      admin,
      viewer.userId,
      viewer.orFilter,
      {
        filter,
        includeMuted,
        mutedCategories: muted,
        limit,
        cursor
      }
    );

    let unread_count: number;
    let counts = null;
    if (withCounts) {
      counts = await notificationFilterCounts(
        admin,
        viewer.userId,
        viewer.orFilter
      );
      unread_count = includeMuted
        ? counts.unread
        : await countUnreadNotifications(
            admin,
            viewer.userId,
            viewer.orFilter,
            muted
          );
    } else {
      unread_count = await countUnreadNotifications(
        admin,
        viewer.userId,
        viewer.orFilter,
        includeMuted ? [] : muted
      );
    }

    const payload: Record<string, unknown> = {
      items,
      unread_count,
      next_cursor: nextCursor
    };

    if (counts) {
      payload.counts = counts;
      payload.total_count = counts.all;
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[notifications] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load notifications" },
      { status: 500 }
    );
  }
}
