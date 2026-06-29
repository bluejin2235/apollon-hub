import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  normalizeCreateRoomType,
  resolvePersonalRoomPayload,
  resolvePublicRoomPayload
} from "@/lib/research/room-create";
import type { TrendRoom } from "@/lib/research/types";

export const runtime = "nodejs";

type CreateRoomBody = {
  name?: string;
  room_type?: string;
  /** @deprecated `name` 사용 */
  week_label?: string;
};

async function findPersonalRoom(admin: NonNullable<ReturnType<typeof getServiceSupabase>>, userId: string) {
  const { data, error } = await admin
    .from("trend_rooms")
    .select("*")
    .eq("room_type", "personal")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as TrendRoom | null) ?? null;
}

async function ensurePersonalRoom(admin: NonNullable<ReturnType<typeof getServiceSupabase>>, userId: string) {
  const existing = await findPersonalRoom(admin, userId);
  if (existing) return existing;

  const payload = resolvePersonalRoomPayload(userId);
  const { data, error } = await admin.from("trend_rooms").insert(payload).select("*").single();

  if (error || !data) {
    console.error("[research/rooms] personal insert failed", error);
    throw new Error(error?.message ?? "개인방 생성에 실패했습니다.");
  }

  return data as TrendRoom;
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

    const type = request.nextUrl.searchParams.get("type")?.trim().toLowerCase();

    if (type === "public" || type === "group") {
      const { data, error } = await admin
        .from("trend_rooms")
        .select("id")
        .or("room_type.eq.public,room_type.eq.group,room_type.is.null")
        .order("week_start", { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const room_ids = (data ?? []).map((row) => row.id as string);
      return NextResponse.json({ room_ids });
    }

    const room = await ensurePersonalRoom(admin, user.id);
    return NextResponse.json({ room });
  } catch (error) {
    console.error("[research/rooms] GET", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 로그인된 멤버 누구나 채팅방 생성 가능 */
export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    let body: CreateRoomBody = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") {
        body = raw as CreateRoomBody;
      }
    } catch {
      body = {};
    }

    const nameInput = body.name?.trim() || body.week_label?.trim();
    const roomType = normalizeCreateRoomType(body.room_type);

    const payload =
      roomType === "personal"
        ? resolvePersonalRoomPayload(user.id, nameInput)
        : resolvePublicRoomPayload(nameInput);

    const { data, error } = await admin.from("trend_rooms").insert(payload).select("*").single();

    if (error || !data) {
      console.error("[research/rooms] insert failed", error);
      return NextResponse.json({ error: error?.message ?? "채팅방 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ room: data as TrendRoom });
  } catch (error) {
    console.error("[research/rooms] POST", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
