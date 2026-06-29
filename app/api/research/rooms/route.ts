import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { resolveCreateTrendRoomPayload } from "@/lib/research/room-create";
import type { TrendRoom } from "@/lib/research/types";

export const runtime = "nodejs";

type CreateRoomBody = {
  week_label?: string;
};

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

    const payload = resolveCreateTrendRoomPayload(body.week_label);

    const { data, error } = await admin
      .from("trend_rooms")
      .insert(payload)
      .select("*")
      .single();

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
