"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { isCurrentWeekRoom, isPublicTrendRoom, type TrendRoom } from "@/lib/research/types";
import { supabase } from "@/lib/supabase/client";

export default function ResearchPage() {
  const router = useRouter();
  const { status, profile } = useRequirePortalSession();
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (status !== "ready" || !profile?.id) return;

    let cancelled = false;

    void (async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        if (!cancelled) setError("로그인 세션이 없습니다.");
        return;
      }

      const personalResponse = await fetch("/api/research/rooms", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const personalData = (await personalResponse.json()) as { room?: TrendRoom; error?: string };

      const { data, error: fetchError } = await supabase
        .from("trend_rooms")
        .select("*")
        .order("week_start", { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const rooms = (data ?? []) as TrendRoom[];
      const roomIds = new Set(rooms.map((room) => room.id));

      const personalRoom =
        personalResponse.ok && personalData.room
          ? personalData.room
          : rooms.find((room) => room.room_type === "personal" && room.owner_id === profile.id);

      const publicRooms = rooms.filter((room) => isPublicTrendRoom(room));
      const currentPublicRoom = publicRooms.find((room) => isCurrentWeekRoom(room));
      const fallbackPublicRoom = publicRooms.find((room) => !room.is_archived) ?? publicRooms[0];

      const { data: latestMessage } = await supabase
        .from("trend_messages")
        .select("room_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const latestRoomId =
        latestMessage && typeof latestMessage.room_id === "string" && roomIds.has(latestMessage.room_id)
          ? latestMessage.room_id
          : null;

      const targetId =
        latestRoomId ??
        personalRoom?.id ??
        currentPublicRoom?.id ??
        fallbackPublicRoom?.id ??
        null;

      if (targetId) {
        router.replace(`/research/${targetId}`);
        return;
      }

      setEmpty(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [status, profile?.id, router]);

  if (status === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        채팅방으로 이동하는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-slate-800">이용 가능한 채팅방이 없습니다.</p>
        <p className="text-xs text-slate-500">왼쪽 메뉴에서 새 채팅방을 만들어 보세요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
      채팅방으로 이동하는 중…
    </div>
  );
}
