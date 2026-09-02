import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { canAccessWebsiteAdmin, getProfileRole } from "@/lib/auth/website-tester";
import { websiteAdminFetch } from "@/lib/website/client";

export const runtime = "nodejs";

type HistoryRow = {
  version?: unknown;
  published_at?: unknown;
  published_by?: unknown;
  change_note?: unknown;
  is_current?: unknown;
};

/**
 * 공개 이력. published_by uuid 에 profiles.name 을 붙인다.
 */
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const role = await getProfileRole(admin, user.id);
  if (!canAccessWebsiteAdmin(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.nextUrl.searchParams.get("contentType") ?? "";
  const contentId = request.nextUrl.searchParams.get("contentId") ?? "";
  if (!contentType || !contentId) {
    return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  }

  const { status, body } = await websiteAdminFetch(
    `/api/admin/publish/history?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}`
  );

  if (status !== 200 || !body || typeof body !== "object") {
    return NextResponse.json(body ?? { error: "history_failed" }, { status });
  }

  const record = body as { data?: { items?: unknown }; error?: unknown };
  const rawItems = Array.isArray(record.data?.items) ? (record.data.items as HistoryRow[]) : [];

  const ids = [
    ...new Set(
      rawItems
        .map((row) => (typeof row.published_by === "string" ? row.published_by : ""))
        .filter(Boolean)
    )
  ];

  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin.from("profiles").select("id, name").in("id", ids);
    for (const row of data ?? []) {
      const id = typeof row.id === "string" ? row.id : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (id && name) names.set(id, name);
    }
  }

  const items = rawItems.map((row) => {
    const publishedBy = typeof row.published_by === "string" ? row.published_by : null;
    return {
      version: typeof row.version === "number" ? row.version : 0,
      published_at: typeof row.published_at === "string" ? row.published_at : "",
      published_by: publishedBy,
      published_by_name: publishedBy ? (names.get(publishedBy) ?? null) : null,
      change_note: typeof row.change_note === "string" ? row.change_note : null,
      is_current: row.is_current === true
    };
  });

  return NextResponse.json({ data: { items } });
}
