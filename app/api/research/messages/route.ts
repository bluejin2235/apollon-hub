import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  mapTrendMessageRow,
  MESSAGE_ID_UUID_RE,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
  TREND_MESSAGE_SELECT
} from "@/lib/research/trend-message-map";

export const runtime = "nodejs";

function parseLimit(value: string | null): number {
  if (!value) return MESSAGE_PAGE_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return MESSAGE_PAGE_DEFAULT_LIMIT;
  return Math.min(parsed, MESSAGE_PAGE_MAX_LIMIT);
}

async function resolveBeforeCreatedAt(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  roomId: string,
  before: string
): Promise<string | null> {
  if (MESSAGE_ID_UUID_RE.test(before)) {
    const { data, error } = await admin
      .from("trend_messages")
      .select("created_at")
      .eq("id", before)
      .eq("room_id", roomId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.created_at ? String(data.created_at) : null;
  }

  const parsed = Date.parse(before);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const roomId = request.nextUrl.searchParams.get("room_id")?.trim();
    if (!roomId) {
      return NextResponse.json({ error: "room_id is required" }, { status: 400 });
    }

    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const beforeRaw = request.nextUrl.searchParams.get("before")?.trim();

    let beforeCreatedAt: string | null = null;
    if (beforeRaw) {
      beforeCreatedAt = await resolveBeforeCreatedAt(admin, roomId, beforeRaw);
      if (!beforeCreatedAt) {
        return NextResponse.json({ error: "Invalid before cursor" }, { status: 400 });
      }
    }

    let query = admin
      .from("trend_messages")
      .select(TREND_MESSAGE_SELECT)
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (beforeCreatedAt) {
      query = query.lt("created_at", beforeCreatedAt);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[research/messages] GET failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row) => mapTrendMessageRow(row as Record<string, unknown>));
    const messages = [...rows].reverse();

    return NextResponse.json({
      messages,
      has_more: rows.length === limit
    });
  } catch (error) {
    console.error("[research/messages] GET", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
